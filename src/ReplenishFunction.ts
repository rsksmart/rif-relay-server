import log from 'loglevel';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import { BigNumber } from 'ethers';
import type { RelayServer } from './RelayServer';
import { ServerAction } from './StoredTransaction';
import type { SendTransactionDetails } from './TransactionManager';
import { defaultEnvironment } from './Environments';

export async function replenishStrategy(
  relayServer: RelayServer,
  workerIndex: number,
  currentBlock: number
): Promise<string[]> {
  let transactionHashes: string[] = [];
  if (relayServer.isCustomReplenish()) {
    // If custom replenish is settled, here should be a call to a custom function for replenish workers strategy.
    // Delete the next error if a custom replenish fuction is implemented.
    throw new Error(
      'No custom replenish function found, to remove this error please add the custom replenish implementation here deleting this line.'
    );
  } else {
    transactionHashes = await defaultReplenishFunction(
      relayServer,
      workerIndex,
      currentBlock
    );
  }

  return transactionHashes;
}

async function defaultReplenishFunction(
  relayServer: RelayServer,
  workerIndex: number,
  currentBlock: number
): Promise<string[]> {
  const transactionHashes: string[] = [];
  const managerEthBalance = await relayServer.getManagerBalance();
  const bigManagerEthBalance = BigNumberJs(managerEthBalance.toString());

  relayServer.workerBalanceRequired.currentValue =
    await relayServer.getWorkerBalance(workerIndex);
  if (
    bigManagerEthBalance.gt(
      relayServer.config.blockchain.managerTargetBalance
    ) &&
    relayServer.workerBalanceRequired.isSatisfied
  ) {
    // all filled, nothing to do
    return transactionHashes;
  }
  const mustReplenishWorker = !relayServer.workerBalanceRequired.isSatisfied;
  const isReplenishPendingForWorker =
    await relayServer.txStoreManager.isActionPending(
      ServerAction.VALUE_TRANSFER,
      relayServer.workerAddress
    );
  if (mustReplenishWorker && !isReplenishPendingForWorker) {
    const targetBalance = BigNumberJs(
      relayServer.config.blockchain.workerTargetBalance
    );
    const refill = targetBalance.minus(
      relayServer.workerBalanceRequired.currentValue.toString()
    );
    log.info(
      `== replenishServer: mgr balance=${bigManagerEthBalance.toString()}
        \n${
          relayServer.workerBalanceRequired.description
        }\n refill=${refill.toString()}`
    );

    if (
      refill.lt(
        bigManagerEthBalance.minus(
          relayServer.config.blockchain.managerMinBalance
        )
      )
    ) {
      log.info('Replenishing worker balance by manager rbtc balance');
      const gasLimit = BigNumber.from(
        defaultEnvironment?.minTxGasCost ?? 21000
      );
      const details: SendTransactionDetails = {
        signer: relayServer.managerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        destination: relayServer.workerAddress,
        value: BigNumber.from(refill.toFixed(0)),
        creationBlockNumber: currentBlock,
        gasLimit,
      };
      const { txHash } = await relayServer.transactionManager.sendTransaction(
        details
      );
      transactionHashes.push(txHash);
    } else {
      const message = `== replenishServer: can't replenish: mgr balance too low ${bigManagerEthBalance.toString()} refill=${refill.toString()}`;
      relayServer.emit('fundingNeeded', message);
      log.info(message);
    }
  }

  return transactionHashes;
}
