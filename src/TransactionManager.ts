import chalk from 'chalk';
import log from 'loglevel';
import { Mutex } from 'async-mutex';
import { utils, BigNumber, PopulatedTransaction, constants } from 'ethers';
import type { TransactionResponse } from '@ethersproject/providers';
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
import { getProvider, getWriteProvider } from './Utils';
import { planBoost } from './planBoost';
import { applyFactor } from './Conversions';
import { getMaxRequestGasPrice } from './relayServerUtils';

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

/**
 * Whether a broadcast failed because the node answered with a JSON-RPC error,
 * i.e. it refused the transaction. Any other failure, such as a timeout or a
 * lost connection, may come after the node accepted the transaction.
 */
export function isRefusedByNode(error: unknown): boolean {
  // ethers wraps the node's error, the one with a numeric JSON-RPC code, in
  // errors of its own under `error`
  let cause = error;
  for (let depth = 0; depth < 4; depth++) {
    if (!cause || typeof cause !== 'object') {
      return false;
    }
    if (typeof (cause as { code?: unknown }).code === 'number') {
      return true;
    }
    cause = (cause as { error?: unknown }).error;
  }

  return false;
}

export class TransactionManager {
  nonceMutex = new Mutex();

  managerKeyManager: KeyManager;

  workersKeyManager: KeyManager;

  nonces: Record<string, number> = {};

  txStoreManager: TxStoreManager;

  config: ServerConfigParams;

  constructor(dependencies: ServerDependencies) {
    this.txStoreManager = dependencies.txStoreManager;
    this.workersKeyManager = dependencies.workersKeyManager;
    this.managerKeyManager = dependencies.managerKeyManager;
    this.config = getServerConfig();
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
    const value = transaction.value ?? 0;

    const gasPrice = transaction.gasPrice ?? 0;

    const valueHumanReadable: string = utils.formatEther(value);
    const gasPriceHumanReadable: string = utils.formatUnits(gasPrice, 'gwei');
    log.info(`Broadcasting transaction:
hash         | ${hash}
from         | ${from}
to           | 0x${transaction.to ?? ''}
value        | ${value.toString()} (${valueHumanReadable} RBTC)
nonce        | ${transaction.nonce ?? 'unnonce'}
gasPrice     | ${gasPrice.toString()} (${gasPriceHumanReadable} gwei)
gasLimit     | ${transaction.gasLimit?.toString() ?? ''}
data         | 0x${transaction.data ?? ''}
`);
  }

  async attemptEstimateGas(
    methodName: string,
    transaction: PopulatedTransaction,
    from: string
  ): Promise<BigNumber> {
    const provider = getProvider();

    try {
      const estimateGas = await provider.estimateGas({
        ...transaction,
        from,
      });

      return applyFactor(estimateGas, this.config.blockchain.estimateGasFactor);
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
    const provider = getProvider();

    const providerGasPrice = await provider.getGasPrice();
    const { chainId } = await provider.getNetwork();

    // The broadcast stays under the mutex so that a transaction the node
    // refuses can give its nonce back before any later transaction takes the
    // next one; otherwise the refused nonce would never be mined and would
    // hold every later transaction of the signer
    const releaseMutex = await this.nonceMutex.acquire();
    try {
      const nonce = await this.pollNonce(signer);

      //TODO check what is the best approach
      const txToSign: PopulatedTransaction = {
        ...(method ? method : {}),
        to: destination,
        value,
        gasLimit,
        gasPrice: gasPrice ?? providerGasPrice,
        nonce,
        chainId,
      };
      // TODO omg! do not do this!
      const keyManager = this.managerKeyManager.isSigner(signer)
        ? this.managerKeyManager
        : this.workersKeyManager;
      const signedTransaction = await keyManager.signTransaction(
        signer,
        txToSign
      );
      const metadata: StoredTransactionMetadata = {
        txId: signedTransaction.txHash,
        from: signer,
        attempts: 1,
        serverAction,
        creationBlockNumber,
      };
      const storedTx = createStoredTransaction(txToSign, metadata);
      this.nonces[signer]++;
      await this.txStoreManager.putTx(storedTx, false);
      this.printSendTransactionLog(txToSign, signer, signedTransaction.txHash);

      let transaction: TransactionResponse;
      try {
        transaction = await getWriteProvider().sendTransaction(
          signedTransaction.signedTx
        );
      } catch (error) {
        if (isRefusedByNode(error)) {
          await this._rollBackRefusedBroadcast(storedTx, error);
        } else {
          // The node may have accepted it, so the nonce stays taken; if it
          // did not, the boost broadcasts the transaction again
          log.warn(
            `Broadcast of transaction ${storedTx.txId} failed without an answer from the node, keeping it:`,
            error instanceof Error ? error.message : error
          );
        }
        throw error;
      }

      if (transaction.hash.toLowerCase() !== storedTx.txId.toLowerCase()) {
        throw new Error(
          `txhash mismatch: from receipt: ${transaction.hash} from txstore:${storedTx.txId}`
        );
      }

      return signedTransaction;
    } finally {
      releaseMutex();
    }
  }

  /**
   * Forgets a transaction the node refused to broadcast and gives its nonce
   * back, so the next transaction of the signer takes it. Must be called
   * under the nonce mutex.
   */
  async _rollBackRefusedBroadcast(
    storedTx: StoredTransaction,
    error: unknown
  ): Promise<void> {
    log.error(
      `Transaction ${storedTx.txId} with nonce ${
        storedTx.nonce ?? 'unnonce'
      } from ${storedTx.from} was refused by the node, giving its nonce back:`,
      error instanceof Error ? error.message : error
    );
    this.nonces[storedTx.from]--;
    await this.txStoreManager.removeTx(storedTx);
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
    isMaxGasPriceReached: boolean,
    value = tx.value
  ): Promise<SignedTransactionDetails> {
    const { chainId } = await getProvider().getNetwork();
    // Resend transaction with the same values except for the gas price and,
    // when the account can't afford it at the new gas price, the value
    const txToSign: PopulatedTransaction = {
      to: tx.to,
      value,
      gasLimit: tx.gasLimit,
      gasPrice: newGasPrice,
      data: tx.data,
      nonce: tx.nonce,
      chainId,
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

    const provider = getWriteProvider();

    this.printSendTransactionLog(txToSign, tx.from, signedTransaction.txHash);
    const currentNonce = await provider.getTransactionCount(tx.from);
    log.debug(`Current account nonce for ${tx.from} is ${currentNonce}`);
    let transaction: TransactionResponse;
    try {
      transaction = await provider.sendTransaction(signedTransaction.signedTx);
    } catch (error) {
      const isSentAgainUnchanged =
        signedTransaction.txHash.toLowerCase() === tx.txId.toLowerCase();
      if (
        isSentAgainUnchanged &&
        isRefusedByNode(error) &&
        (await this._isPendingOnNode(signedTransaction.txHash))
      ) {
        // The node refuses a transaction it already has in its pool, e.g. one
        // at a price that can't be raised; it was sent, so the boost goes on
        // with the next one and the attempt makes it wait for the timeout. A
        // transaction the node has mined is not taken as sent: the store is
        // behind, and the later transactions would be planned against a
        // balance that already paid for it, so the refusal stops the boost
        log.debug(
          `Transaction ${tx.txId} sent again unchanged is already pending on the node`
        );

        return signedTransaction;
      }
      if (isRefusedByNode(error)) {
        log.error(
          `Boosted transaction ${signedTransaction.txHash} was refused by the node, keeping ${tx.txId}:`,
          error instanceof Error ? error.message : error
        );
        // Keep tracking the transaction as it was last broadcast, so the next
        // boost starts from a gas price the node has seen, but keep this
        // attempt, so it waits for the next timeout instead of being sent on
        // every block; a transaction sent again unchanged is already stored that way
        if (!isSentAgainUnchanged) {
          await this.txStoreManager.putTx(
            {
              ...tx,
              attempts: storedTx.attempts,
              boostBlockNumber: storedTx.boostBlockNumber,
            },
            true
          );
        }
      } else {
        // Either hash may be mined; the boost is kept since it is the one
        // that mines if the node accepted it, and removeConfirmedTransactions
        // clears it once the nonce is confirmed under the other hash
        log.warn(
          `Broadcast of boosted transaction ${signedTransaction.txHash} failed without an answer from the node, keeping it in place of ${tx.txId}:`,
          error instanceof Error ? error.message : error
        );
      }
      throw error;
    }
    if (transaction.hash.toLowerCase() !== storedTx.txId.toLowerCase()) {
      throw new Error(
        `txhash mismatch: from receipt: ${transaction.hash} from txstore:${storedTx.txId}`
      );
    }

    return signedTransaction;
  }

  /**
   * Whether the write node, the one transactions are broadcast to, has the
   * transaction in its pool, not yet mined. A failed lookup counts as not.
   */
  async _isPendingOnNode(txHash: string): Promise<boolean> {
    try {
      const transaction = await getWriteProvider().getTransaction(txHash);

      return transaction != null && transaction.blockNumber == null;
    } catch (error) {
      log.warn(
        `Could not look up transaction ${txHash} on the node:`,
        error instanceof Error ? error.message : error
      );

      return false;
    }
  }

  /**
   * The highest gas price a stale transaction is boosted to: the configured
   * maxGasPrice, so we are not burning all our balance in gas fees, or the
   * highest price the node accepts if that is lower; see getMaxRequestGasPrice
   */
  _getMaxBoostGasPrice(nodeGasPrice: BigNumber): BigNumber {
    const maxGasPrice = BigNumber.from(this.config.blockchain.maxGasPrice);
    const maxAcceptedGasPrice = getMaxRequestGasPrice(
      nodeGasPrice,
      this.config.blockchain
    );

    return maxAcceptedGasPrice.lt(maxGasPrice)
      ? maxAcceptedGasPrice
      : maxGasPrice;
  }

  _resolveNewGasPrice(
    oldGasPrice: BigNumber | undefined,
    nodeGasPrice: BigNumber
  ): {
    newGasPrice: BigNumber;
    isMaxGasPriceReached: boolean;
  } {
    let isMaxGasPriceReached = false;
    let newGasPrice = applyFactor(
      oldGasPrice ?? 0,
      this.config.blockchain.retryGasPriceFactor
    );

    const maxGasPrice = this._getMaxBoostGasPrice(nodeGasPrice);

    if (newGasPrice.gt(maxGasPrice)) {
      isMaxGasPriceReached = true;
      newGasPrice = maxGasPrice;
    }

    return { newGasPrice, isMaxGasPriceReached };
  }

  async pollNonce(signer: string): Promise<number> {
    const provider = getWriteProvider();

    const nonce: number = await provider.getTransactionCount(signer, 'pending');
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

  /**
   * Whether a transaction of the signer with the given nonce, under any hash,
   * was mined at least confirmationsNeeded blocks ago
   */
  async _isNonceConfirmed(
    signer: string,
    nonce: number,
    blockNumber: number
  ): Promise<boolean> {
    const confirmedBlock =
      blockNumber - this.config.blockchain.confirmationsNeeded;
    if (confirmedBlock < 0) {
      return false;
    }
    const confirmedNonce = await getProvider().getTransactionCount(
      signer,
      confirmedBlock
    );

    return confirmedNonce > nonce;
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
    const provider = getProvider();

    // Get nonce at confirmationsNeeded blocks ago
    for (const transaction of sortedTxs) {
      const shouldRecheck =
        transaction.minedBlockNumber == null ||
        blockNumber - transaction.minedBlockNumber >=
          this.config.blockchain.confirmationsNeeded;
      if (shouldRecheck) {
        const receipt: TransactionResponse = await provider.getTransaction(
          transaction.txId
        );
        if (receipt == null) {
          // A broadcast whose outcome was unknown may have left the store
          // with a hash other than the one mined for its nonce
          if (
            transaction.nonce != null &&
            (await this._isNonceConfirmed(
              transaction.from,
              transaction.nonce,
              blockNumber
            ))
          ) {
            log.debug(
              `removing tx number ${transaction.nonce} sent by ${transaction.from}, confirmed under a hash other than ${transaction.txId}`
            );
            await this.txStoreManager.removeTxsUntilNonce(
              transaction.from,
              transaction.nonce
            );
            continue;
          }
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
    // The boost runs under the nonce mutex, from reading the store to its last
    // broadcast, so it never replaces a transaction whose first broadcast is
    // still in flight: if the node then refused that broadcast, its nonce would
    // be given back while the store kept the boost under the same nonce
    const releaseMutex = await this.nonceMutex.acquire();
    try {
      return await this._boostUnderpricedPendingTransactionsForSigner(
        signer,
        currentBlockHeight
      );
    } finally {
      releaseMutex();
    }
  }

  async _boostUnderpricedPendingTransactionsForSigner(
    signer: string,
    currentBlockHeight: number
  ): Promise<Map<string, SignedTransactionDetails>> {
    const boostedTransactions = new Map<string, SignedTransactionDetails>();

    // Load unconfirmed transactions from store again
    const sortedTxs = await this.txStoreManager.getAllBySigner(signer);
    if (sortedTxs.length === 0) {
      return boostedTransactions;
    }

    const provider = getProvider();

    // Check if the tx was mined by comparing its nonce against the latest one.
    // The transactions are broadcast to the write node, which can be ahead of
    // a lagging read node; a mined transaction re-signed and broadcast again
    // is refused as a nonce too low, so the higher of the two counts is used
    const nonce = Math.max(
      await provider.getTransactionCount(signer),
      await getWriteProvider().getTransactionCount(signer)
    );
    const oldestPendingTx = sortedTxs[0];
    if (oldestPendingTx) {
      if (
        oldestPendingTx.nonce !== undefined &&
        oldestPendingTx.nonce < nonce
      ) {
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
      const nodeGasPrice = await provider.getGasPrice();
      const { newGasPrice, isMaxGasPriceReached } = this._resolveNewGasPrice(
        oldestPendingTx.gasPrice,
        nodeGasPrice
      );

      // the write node accepts or refuses the replacements, so they have to fit
      // in the balance it sees
      const balance = await getWriteProvider().getBalance(signer);
      for (const { transaction, gasPrice, value } of planBoost(
        sortedTxs,
        balance,
        newGasPrice
      )) {
        const storedValue = transaction.value ?? constants.Zero;
        if (value.lt(storedValue)) {
          log.info(
            `${signer} : lowering the value of transaction ${
              transaction.txId
            } from ${storedValue.toString()} to ${value.toString()} to pay for the new gas price`
          );
        }

        const boostedTransactionDetails = await this.resendTransaction(
          transaction,
          currentBlockHeight,
          gasPrice,
          isMaxGasPriceReached,
          value
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
