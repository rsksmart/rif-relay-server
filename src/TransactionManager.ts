import chalk from 'chalk';
import log from 'loglevel';
import { Mutex } from 'async-mutex';
import {
  utils,
  BigNumber,
  PopulatedTransaction,
  constants,
  providers,
  getDefaultProvider,
} from 'ethers';
import type { TransactionResponse } from '@ethersproject/providers';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import type { TxStoreManager } from './TxStoreManager';
import type { KeyManager } from './KeyManager';
import {
  ServerDependencies,
  ServerConfigParams,
  getServerConfig,
} from './ServerConfigParams';
import {
  createStoredTransaction,
  ServerAction,
  StoredTransaction,
  StoredTransactionMetadata,
} from './StoredTransaction';

export interface SignedTransactionDetails {
  txHash: string;
  signedTx: string;
}

export interface SendTransactionDetails {
  signer: string;
  serverAction: ServerAction;
  method?: PopulatedTransaction;
  destination: string;
  value?: BigNumber;
  gasLimit: BigNumber;
  gasPrice?: BigNumber;
  creationBlockNumber: number;
}

export class TransactionManager {
  nonceMutex = new Mutex();

  managerKeyManager: KeyManager;

  workersKeyManager: KeyManager;

  nonces: Record<string, number> = {};

  txStoreManager: TxStoreManager;

  config: ServerConfigParams;

  private readonly _provider: providers.Provider;

  constructor(dependencies: ServerDependencies) {
    this.txStoreManager = dependencies.txStoreManager;
    this.workersKeyManager = dependencies.workersKeyManager;
    this.managerKeyManager = dependencies.managerKeyManager;
    this.config = getServerConfig();
    this._provider = getDefaultProvider();
    this._initNonces();
  }

  _initNonces(): void {
    const managerAddress = this.managerKeyManager.getAddress(0);
    // todo: initialize nonces for all signers (currently one manager, one worker)
    this.nonces[managerAddress as string] = 0;
    this.nonces[this.workersKeyManager.getAddress(0) as string] = 0;
  }

  printBoostedTransactionLog(
    txHash: string,
    creationBlockNumber: number,
    gasPrice: number,
    isMaxGasPriceReached: boolean
  ): void {
    const gasPriceHumanReadableOld: string = utils.formatUnits(
      BigNumber.from(gasPrice),
      'gwei'
    );
    log.info(`Boosting stale transaction:
hash         | ${txHash}
gasPrice     | ${gasPrice} (${gasPriceHumanReadableOld} gwei) ${
      isMaxGasPriceReached ? chalk.red('k256') : ''
    }
created at   | block #${creationBlockNumber}
`);
  }

  printSendTransactionLog(
    transaction: PopulatedTransaction,
    from: string,
    hash: string
  ): void {
    const valueHumanReadable: string = utils.formatEther(
      transaction.value ?? ''
    );
    const gasPriceHumanReadable: string = utils.formatUnits(
      transaction.gasPrice?.toString() ?? '',
      'gwei'
    );
    log.info(`Broadcasting transaction:
hash         | ${hash}
from         | ${from}
to           | 0x${transaction.to ?? ''}
value        | ${
      transaction.value?.toString() ?? ''
    } (${valueHumanReadable} RBTC)
nonce        | ${transaction.nonce ?? 0}
gasPrice     | ${
      transaction.gasPrice?.toString() ?? ''
    } (${gasPriceHumanReadable} gwei)
gasLimit     | ${transaction.gasLimit?.toString() ?? ''}
data         | 0x${transaction.data ?? ''}
`);
  }

  async attemptEstimateGas(
    methodName: string,
    transaction: PopulatedTransaction,
    from: string
  ): Promise<BigNumber> {
    try {
      const estimateGas = await this._provider.estimateGas({
        ...transaction,
        from,
      });
      const bigEstimateGasFactor = BigNumberJs(
        this.config.blockchain.estimateGasFactor
      );
      const mul = bigEstimateGasFactor.multipliedBy(estimateGas.toString());

      return BigNumber.from(mul.toFixed(0));
    } catch (e) {
      if (e instanceof Error) {
        log.error(
          `Failed to estimate gas for method ${methodName}\n. Using default ${this.config.blockchain.defaultGasLimit.toString()}`,
          e.message
        );
      } else {
        log.error(e);
      }
    }

    return BigNumber.from(this.config.blockchain.defaultGasLimit);
  }

  async sendTransaction({
    signer,
    method,
    destination,
    value = constants.Zero,
    gasLimit,
    gasPrice,
    creationBlockNumber,
    serverAction,
  }: SendTransactionDetails): Promise<SignedTransactionDetails> {
    const tempGasPrice = await this._provider.getGasPrice();

    const releaseMutex = await this.nonceMutex.acquire();
    let signedTransaction: SignedTransactionDetails;
    let storedTx: StoredTransaction;
    try {
      const nonce = await this.pollNonce(signer);

      //TODO check what is the best approach
      const txToSign: PopulatedTransaction = {
        ...(method ? method : {}),
        to: destination,
        value,
        gasLimit,
        gasPrice: BigNumber.from(gasPrice ?? tempGasPrice),
        nonce,
      };
      // TODO omg! do not do this!
      const keyManager = this.managerKeyManager.isSigner(signer)
        ? this.managerKeyManager
        : this.workersKeyManager;
      signedTransaction = await keyManager.signTransaction(signer, txToSign);
      const metadata: StoredTransactionMetadata = {
        txId: signedTransaction.txHash,
        from: signer,
        attempts: 1,
        serverAction,
        creationBlockNumber,
      };
      storedTx = createStoredTransaction(txToSign, metadata);
      this.nonces[signer]++;
      await this.txStoreManager.putTx(storedTx, false);
      this.printSendTransactionLog(txToSign, signer, signedTransaction.txHash);
    } finally {
      releaseMutex();
    }

    const transaction = await this._provider.sendTransaction(
      signedTransaction.signedTx
    );

    if (transaction.hash.toLowerCase() !== storedTx.txId.toLowerCase()) {
      throw new Error(
        `txhash mismatch: from receipt: ${transaction.hash} from txstore:${storedTx.txId}`
      );
    }

    return signedTransaction;
  }

  async updateTransactionWithMinedBlock(
    tx: StoredTransaction,
    minedBlockNumber: number
  ): Promise<void> {
    const storedTx: StoredTransaction = Object.assign({}, tx, {
      minedBlockNumber,
    });
    await this.txStoreManager.putTx(storedTx, true);
  }

  async updateTransactionWithAttempt(
    txId: string,
    txToSign: PopulatedTransaction,
    tx: StoredTransaction,
    currentBlock: number
  ): Promise<StoredTransaction> {
    const metadata: StoredTransactionMetadata = {
      txId,
      attempts: tx.attempts + 1,
      boostBlockNumber: currentBlock,
      from: tx.from,
      serverAction: tx.serverAction,
      creationBlockNumber: tx.creationBlockNumber,
      minedBlockNumber: tx.minedBlockNumber,
    };
    const storedTx = createStoredTransaction(txToSign, metadata);
    await this.txStoreManager.putTx(storedTx, true);

    return storedTx;
  }

  async resendTransaction(
    tx: StoredTransaction,
    currentBlock: number,
    newGasPrice: BigNumber,
    isMaxGasPriceReached: boolean
  ): Promise<SignedTransactionDetails> {
    // Resend transaction with exactly the same values except for gas price
    const txToSign: PopulatedTransaction = {
      ...tx,
      gasPrice: newGasPrice,
    };

    const keyManager = this.managerKeyManager.isSigner(tx.from)
      ? this.managerKeyManager
      : this.workersKeyManager;
    const signedTransaction = await keyManager.signTransaction(
      tx.from,
      txToSign
    );
    const storedTx = await this.updateTransactionWithAttempt(
      signedTransaction.txHash,
      txToSign,
      tx,
      currentBlock
    );

    this.printBoostedTransactionLog(
      tx.txId,
      tx.creationBlockNumber,
      Number(tx.gasPrice),
      isMaxGasPriceReached
    );
    this.printSendTransactionLog(txToSign, tx.from, signedTransaction.txHash);
    const currentNonce = await this._provider.getTransactionCount(tx.from);
    log.debug(`Current account nonce for ${tx.from} is ${currentNonce}`);
    const transaction = await this._provider.sendTransaction(
      signedTransaction.signedTx
    );
    if (transaction.hash.toLowerCase() !== storedTx.txId.toLowerCase()) {
      throw new Error(
        `txhash mismatch: from receipt: ${transaction.hash} from txstore:${storedTx.txId}`
      );
    }

    return signedTransaction;
  }

  _resolveNewGasPrice(oldGasPrice: BigNumber | undefined): {
    newGasPrice: BigNumber;
    isMaxGasPriceReached: boolean;
  } {
    let isMaxGasPriceReached = false;
    const bigRetryGasPriceFactor = BigNumberJs(
      this.config.blockchain.retryGasPriceFactor
    );
    const oldPrice = BigNumber.from(oldGasPrice);
    const bigOldGasPrice = BigNumberJs(oldPrice.toString());

    const bigNewGasPrice = bigRetryGasPriceFactor.multipliedBy(bigOldGasPrice);

    let newGasPrice = BigNumber.from(bigNewGasPrice.toFixed(0));

    const maxGasPrice = BigNumber.from(this.config.blockchain.maxGasPrice);

    // Sanity check to ensure we are not burning all our balance in gas fees
    if (newGasPrice.gt(maxGasPrice)) {
      isMaxGasPriceReached = true;
      newGasPrice = maxGasPrice;
    }

    return { newGasPrice, isMaxGasPriceReached };
  }

  async pollNonce(signer: string): Promise<number> {
    const nonce: number = await this._provider.getTransactionCount(
      signer,
      'pending'
    );
    const nonceSigner = this.nonces[signer] ?? 0;

    if (nonce < nonceSigner) {
      return nonceSigner;
    }

    log.warn(
      'NONCE FIX for signer=',
      signer,
      ': nonce=',
      nonce,
      this.nonces[signer]
    );
    this.nonces[signer] = nonce;

    return nonce;
  }

  async removeConfirmedTransactions(blockNumber: number): Promise<void> {
    // Load unconfirmed transactions from store, and bail if there are none
    const sortedTxs = await this.txStoreManager.getAll();
    if (sortedTxs.length === 0) {
      return;
    }
    log.debug(
      `Total of ${sortedTxs.length} transactions are not confirmed yet, checking...`
    );
    // Get nonce at confirmationsNeeded blocks ago
    for (const transaction of sortedTxs) {
      const shouldRecheck =
        transaction.minedBlockNumber == null ||
        blockNumber - transaction.minedBlockNumber >=
          this.config.blockchain.confirmationsNeeded;
      if (shouldRecheck) {
        const receipt: TransactionResponse =
          await this._provider.getTransaction(transaction.txId);
        if (receipt == null) {
          log.warn(
            `warning: failed to fetch receipt for tx ${transaction.txId}`
          );
          continue;
        }
        if (receipt.blockNumber == null) {
          log.warn(
            `warning: null block number in receipt for ${transaction.txId}`
          );
          continue;
        }
        const confirmations = blockNumber - receipt.blockNumber;
        if (receipt.blockNumber !== transaction.minedBlockNumber) {
          if (transaction.minedBlockNumber != null) {
            log.warn(
              `transaction ${transaction.txId} was moved between blocks`
            );
          }
          if (confirmations < this.config.blockchain.confirmationsNeeded) {
            log.debug(
              `Tx ${transaction.txId} was mined but only has ${confirmations} confirmations`
            );
            await this.updateTransactionWithMinedBlock(
              transaction,
              receipt.blockNumber
            );
            continue;
          }
        }
        // Clear out all confirmed transactions (ie txs with nonce less than the account nonce at confirmationsNeeded blocks ago)
        log.debug(
          `removing tx number ${receipt.nonce} sent by ${receipt.from} with ${confirmations} confirmations`
        );
        await this.txStoreManager.removeTxsUntilNonce(
          receipt.from,
          receipt.nonce
        );
      }
    }
  }

  /**
   * This methods uses the oldest pending transaction for reference. If it was not mined in a reasonable time,
   * it is boosted all consequent transactions with gas price lower then that are boosted as well.
   */
  async boostUnderpricedPendingTransactionsForSigner(
    signer: string,
    currentBlockHeight: number
  ): Promise<Map<string, SignedTransactionDetails>> {
    const boostedTransactions = new Map<string, SignedTransactionDetails>();

    // Load unconfirmed transactions from store again
    const sortedTxs = await this.txStoreManager.getAllBySigner(signer);
    if (sortedTxs.length === 0) {
      return boostedTransactions;
    }
    // Check if the tx was mined by comparing its nonce against the latest one
    const nonce = await this._provider.getTransactionCount(signer);
    const oldestPendingTx = sortedTxs[0];
    if (oldestPendingTx) {
      if (oldestPendingTx.nonce && oldestPendingTx.nonce < nonce) {
        log.debug(
          `${signer} : transaction is mined, awaiting confirmations. Account nonce: ${nonce}, oldest transaction: nonce: ${oldestPendingTx.nonce} txId: ${oldestPendingTx.txId}`
        );

        return boostedTransactions;
      }

      const lastSentAtBlockHeight =
        oldestPendingTx.boostBlockNumber ?? oldestPendingTx.creationBlockNumber;
      // If the tx is still pending, check how long ago we sent it, and resend it if needed
      if (
        currentBlockHeight - lastSentAtBlockHeight <
        this.config.blockchain.pendingTransactionTimeoutBlocks
      ) {
        log.debug(
          `${signer} : awaiting transaction with ID: ${oldestPendingTx.txId} to be mined. creationBlockNumber: ${oldestPendingTx.creationBlockNumber} nonce: ${nonce}`
        );

        return boostedTransactions;
      }

      // Calculate new gas price as a % increase over the previous one
      const { newGasPrice, isMaxGasPriceReached } = this._resolveNewGasPrice(
        oldestPendingTx.gasPrice
      );

      //TODO check if there is no issue with the type conversion
      const underpricedTransactions = sortedTxs.filter(
        (it) => it.gasPrice && it.gasPrice < newGasPrice
      );
      for (const transaction of underpricedTransactions) {
        const boostedTransactionDetails = await this.resendTransaction(
          transaction,
          currentBlockHeight,
          newGasPrice,
          isMaxGasPriceReached
        );
        boostedTransactions.set(transaction.txId, boostedTransactionDetails);
        log.debug(
          `Replaced transaction: nonce: ${
            transaction.nonce ?? 'unnonce'
          } sender: ${signer} | ${transaction.txId} => ${
            boostedTransactionDetails.txHash
          }`
        );
        if (transaction.attempts > 2) {
          log.debug(
            `resend ${signer}: Sent tx ${transaction.attempts} times already`
          );
        }
      }
    }

    return boostedTransactions;
  }
}
