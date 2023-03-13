import log from 'loglevel';
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
  const managerBalance = await relayServer.getManagerBalance();

  relayServer.workerBalanceRequired.currentValue =
    await relayServer.getWorkerBalance(workerIndex);

  const {
    config: {
      blockchain: { managerTargetBalance },
    },
  } = relayServer;

  log.info(
    'Notifier | ',
    `Required Manager Balance: ${managerTargetBalance}`,
    `Manager Balance: ${managerBalance.toString()}`
  );

  if (
    managerBalance.gt(relayServer.config.blockchain.managerTargetBalance) &&
    relayServer.workerBalanceRequired.isSatisfied
  ) {
    log.info('Notifier | ', 'Manager Balance is met');

    // all filled, nothing to do
    return transactionHashes;
  }
  const mustReplenishWorker = !relayServer.workerBalanceRequired.isSatisfied;
  log.info('Notifier | ', 'Worker must be replenished: ', mustReplenishWorker);
  const isReplenishPendingForWorker =
    await relayServer.txStoreManager.isActionPending(
      ServerAction.VALUE_TRANSFER,
      relayServer.workerAddress
    );
  if (mustReplenishWorker && !isReplenishPendingForWorker) {
    log.info('Notifier | ', 'No replenish action pending, replenishing...');
    const workerTargetBalance = BigNumber.from(
      relayServer.config.blockchain.workerTargetBalance
    );
    const refill = workerTargetBalance.sub(
      relayServer.workerBalanceRequired.currentValue
    );

    log.info(
      'Notifier | ',
      `Worker Target Balance: ${workerTargetBalance.toString()}`,
      `Worker Current Balance: ${relayServer.workerBalanceRequired.currentValue.toString()}`,
      `Worker Refill Value: ${refill.toString()}`
    );

    log.info(
      `== replenishServer: mgr balance=${managerBalance.toString()}
        \n${
          relayServer.workerBalanceRequired.description
        }\n refill=${refill.toString()}`
    );

    if (
      refill.lt(
        managerBalance.sub(relayServer.config.blockchain.managerMinBalance)
      )
    ) {
      log.info(
        'Notifier: | Replenishing worker balance by manager rbtc balance'
      );
      const gasLimit = BigNumber.from(
        defaultEnvironment?.minTxGasCost ?? 21000
      );
      const details: SendTransactionDetails = {
        signer: relayServer.managerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        destination: relayServer.workerAddress,
        value: refill,
        creationBlockNumber: currentBlock,
        gasLimit,
      };
      const { txHash } = await relayServer.transactionManager.sendTransaction(
        details
      );
      transactionHashes.push(txHash);
    } else {
      log.info('Notifier | ', 'Not possible to replenish');
      const message = `== replenishServer: can't replenish: mgr balance too low ${managerBalance.toString()} refill=${refill.toString()}`;
      relayServer.emit('fundingNeeded', message);
      log.info(message);
    }
  }

  return transactionHashes;
}
