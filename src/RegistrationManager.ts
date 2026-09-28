import log from 'loglevel';
import type { EventEmitter } from 'events';
import { constants, BigNumber, providers } from 'ethers';
import chalk from 'chalk';

import type {
  IRelayHub,
  TypedEvent,
  StakeUnlockedEvent,
} from '@rsksmart/rif-relay-contracts';

import type {
  SendTransactionDetails,
  TransactionManager,
} from './TransactionManager';
import type { TxStoreManager } from './TxStoreManager';
import { ServerAction } from './StoredTransaction';
import { AmountRequired } from './AmountRequired';
import { defaultEnvironment } from './Environments';

import {
  boolString,
  getLatestEventData,
  getProvider,
  getRelayHub,
  getRelayInfo,
  isRegistrationValid,
} from './Utils';
import type { ManagerEvent, PastEventOptions } from './definitions/event.type';
import { getServerConfig } from './ServerConfigParams';
import { getPastEventsForHub } from './getPastEventsForHub';
import type { RelayManagerData } from '@rsksmart/rif-relay-client';

export type RelayServerRegistryInfo = {
  url: string;
};

const minTxGasCost = defaultEnvironment?.minTxGasCost;

export class RegistrationManager {
  private _balanceRequired: AmountRequired;

  public get balanceRequired(): AmountRequired {
    return this._balanceRequired;
  }

  private _stakeRequired: AmountRequired;

  public get stakeRequired(): AmountRequired {
    return this._stakeRequired;
  }

  private _isStakeLocked = false;

  private _isInitialized = false;

  private readonly _hubAddress: string;

  private readonly _managerAddress: string;

  private readonly _workerAddress: string;

  private readonly _eventEmitter: EventEmitter;

  private _ownerAddress: string | undefined;

  private readonly _transactionManager: TransactionManager;

  private readonly _txStoreManager: TxStoreManager;

  private _relayData: RelayManagerData | undefined;

  private _isWorkerAdded = false;

  private _delayedEvents: Array<{ block: number; eventData: TypedEvent }> = [];

  get isStakeLocked(): boolean {
    return this._isStakeLocked;
  }

  set isStakeLocked(newValue: boolean) {
    const oldValue = this._isStakeLocked;
    this._isStakeLocked = newValue;
    if (newValue !== oldValue) {
      log.info(`Manager stake is ${newValue ? 'now' : 'no longer'} locked`);
      this.printNotRegisteredMessage();
    }
  }

  constructor(
    transactionManager: TransactionManager,
    txStoreManager: TxStoreManager,
    eventEmitter: EventEmitter,
    // exposed from key manager?
    managerAddress: string,
    workerAddress: string
  ) {
    const {
      blockchain: { managerMinBalance, managerMinStake },
      contracts: { relayHubAddress },
    } = getServerConfig();
    const listener = (): void => {
      this.printNotRegisteredMessage();
    };
    this._balanceRequired = new AmountRequired(
      'Balance',
      BigNumber.from(managerMinBalance),
      listener
    );
    this._stakeRequired = new AmountRequired(
      'Stake',
      BigNumber.from(managerMinStake),
      listener
    );

    this._hubAddress = relayHubAddress;
    this._managerAddress = managerAddress;
    this._workerAddress = workerAddress;
    this._eventEmitter = eventEmitter;
    this._transactionManager = transactionManager;
    this._txStoreManager = txStoreManager;
  }

  /**
   * Rebuilds the worker state from hub events since `initialBlockToScan`; the stake
   * is rebuilt when the first handlePastEvents call replays the stake events.
   */
  async init(initialBlockToScan = 1): Promise<void> {
    const workersAddedEvents = await getPastEventsForHub(
      this._managerAddress,
      {
        fromBlock: initialBlockToScan,
      },
      ['RelayWorkersAdded']
    );
    this._isWorkerAdded = workersAddedEvents.length > 0;

    this._isInitialized = true;
  }

  /**
   * Reads the registration state from the hub as of `stateBlock`; changes after it
   * are picked up from the events scanned by handlePastEvents.
   */
  async initFromChain(stateBlock: number): Promise<void> {
    // a hub deployed after stateBlock has nothing registered yet; its events are scanned from the next block
    const hubCode = await getProvider().getCode(this._hubAddress, stateBlock);
    if (hubCode === '0x') {
      this._isInitialized = true;

      return;
    }

    const { withdrawBlock, unstakeDelay } = await this.refreshStake(stateBlock);
    this._isWorkerAdded = await this._isWorkerAssigned(stateBlock);

    if (withdrawBlock.gt(constants.Zero)) {
      // the unstake delay can only grow, so the unlock happened within this range
      const unlockEvents = await getPastEventsForHub(
        this._managerAddress,
        {
          fromBlock: withdrawBlock.sub(unstakeDelay).toNumber(),
          toBlock: stateBlock,
        },
        ['StakeUnlocked']
      );
      const unlockEvent = getLatestEventData(unlockEvents);
      if (unlockEvent) {
        this._delayedEvents.push({
          block: withdrawBlock.toNumber(),
          eventData: unlockEvent,
        });
      }
    }

    this._isInitialized = true;
  }

  async handlePastEvents(
    hubEventsSinceLastScan: TypedEvent[],
    lastScannedBlock: number,
    currentBlock: number,
    forceRegistration: boolean
  ): Promise<string[]> {
    if (!this._isInitialized) {
      throw new Error('RegistrationManager not initialized');
    }
    const options: PastEventOptions = {
      fromBlock: lastScannedBlock + 1,
      toBlock: 'latest',
    };

    type DefaultManagerEvent = Extract<
      ManagerEvent,
      'StakeAdded' | 'StakeUnlocked' | 'StakeWithdrawn'
    >;
    const eventsNames: DefaultManagerEvent[] = [
      'StakeAdded',
      'StakeUnlocked',
      'StakeWithdrawn',
    ];

    const decodedEvents = await getPastEventsForHub(
      this._managerAddress,
      options,
      eventsNames
    );
    this.printEvents(decodedEvents, options);
    let transactionHashes: string[] = [];
    // TODO: what about 'penalize' events? should send balance to owner, I assume
    for (const eventData of decodedEvents) {
      switch (eventData.event) {
        case 'StakeAdded':
          await this.refreshStake();
          break;
        case 'StakeUnlocked':
          await this.refreshStake();

          this._delayedEvents.push({
            block: (
              eventData as StakeUnlockedEvent
            ).args.withdrawBlock.toNumber(),
            eventData,
          });
          break;
        case 'StakeWithdrawn':
          await this.refreshStake();
          transactionHashes = transactionHashes.concat(
            await this._handleStakeWithdrawnEvent(eventData, currentBlock)
          );
          break;
      }
    }

    const relayData = await this.getRelayData();

    this._relayData = {
      currentlyStaked: await relayData.currentlyStaked,
      manager: await relayData.manager,
      registered: await relayData.registered,
      url: await relayData.url,
    };

    for (const eventData of hubEventsSinceLastScan) {
      switch (eventData.event) {
        case 'RelayWorkersAdded':
          this._isWorkerAdded = true;
          break;
      }
    }

    // handle HubUnauthorized only after the due time
    for (const eventData of this._extractDuePendingEvents(currentBlock)) {
      switch (eventData.event) {
        case 'StakeUnlocked':
          transactionHashes = transactionHashes.concat(
            await this._handleStakeUnlockedEvent(eventData, currentBlock)
          );
          break;
      }
    }

    const isRegistrationCorrect = this._isRegistrationCorrect();
    const isRegistrationPending = await this._txStoreManager.isActionPending(
      ServerAction.REGISTER_SERVER
    );
    if (
      !(isRegistrationPending || isRegistrationCorrect) ||
      forceRegistration
    ) {
      transactionHashes = transactionHashes.concat(
        await this.attemptRegistration(currentBlock)
      );
    }

    return transactionHashes;
  }

  async getRelayData(): Promise<IRelayHub.RelayManagerDataStruct> {
    const relayData: IRelayHub.RelayManagerDataStruct[] = await getRelayInfo(
      new Set<string>([this._managerAddress])
    );
    if (relayData.length > 1) {
      throw new Error(
        'More than one relay manager found for ' + this._managerAddress
      );
    }
    if (relayData.length == 1 && relayData[0]) {
      return relayData[0];
    }
    throw new Error('No relay manager found for ' + this._managerAddress);
  }

  private _extractDuePendingEvents(currentBlock: number): TypedEvent[] {
    const ret = this._delayedEvents
      .filter((event) => event.block <= currentBlock)
      .map((e) => e.eventData);
    this._delayedEvents = [
      ...this._delayedEvents.filter((event) => event.block > currentBlock),
    ];

    return ret;
  }

  private _isRegistrationCorrect(): boolean {
    return isRegistrationValid(this._relayData, this._managerAddress);
  }

  private async _handleStakeWithdrawnEvent(
    dlog: TypedEvent,
    currentBlock: number
  ): Promise<string[]> {
    log.warn('Handling StakeWithdrawn event:', dlog);

    return await this.withdrawAllFunds(true, currentBlock);
  }

  private async _handleStakeUnlockedEvent(
    dlog: TypedEvent,
    currentBlock: number
  ): Promise<string[]> {
    log.warn('Handling StakeUnlocked event:', dlog);

    return await this.withdrawAllFunds(false, currentBlock);
  }

  /**
   * @param withdrawManager - whether to send the relay manager's balance to the owner.
   *        Note that more than one relay process could be using the same manager account.
   * @param currentBlock
   */
  async withdrawAllFunds(
    withdrawManager: boolean,
    currentBlock: number
  ): Promise<string[]> {
    let transactionHashes: string[] = [];
    transactionHashes = transactionHashes.concat(
      await this._sendWorkersEthBalancesToOwner(currentBlock)
    );
    if (withdrawManager) {
      transactionHashes = transactionHashes.concat(
        await this._sendManagerEthBalanceToOwner(currentBlock)
      );
    }

    this._eventEmitter.emit('unstaked');

    return transactionHashes;
  }

  async refreshBalance(): Promise<void> {
    const provider = getProvider();

    const currentBalance = await provider.getBalance(this._managerAddress);
    this._balanceRequired.currentValue = currentBalance;
  }

  async refreshStake(blockTag: providers.BlockTag = 'latest') {
    const relayHub = getRelayHub(this._hubAddress);

    const stakeInfo = await relayHub.getStakeInfo(this._managerAddress, {
      blockTag,
    });

    const stake = stakeInfo.stake;
    if (stake.eq(constants.Zero)) {
      return stakeInfo;
    }

    // a locked stake does not have the 'withdrawBlock' field set
    this.isStakeLocked = stakeInfo.withdrawBlock.eq(constants.Zero);
    this._stakeRequired.currentValue = stake;

    // first time getting stake, setting owner
    if (!this._ownerAddress) {
      this._ownerAddress = stakeInfo.owner;
      log.info('Got staked for the first time');
      this.printNotRegisteredMessage();
    }

    return stakeInfo;
  }

  async addRelayWorker(currentBlock: number): Promise<string> {
    const relayHub = getRelayHub(this._hubAddress);

    // register on chain
    const addRelayWorkerMethod =
      await relayHub.populateTransaction.addRelayWorkers([this._workerAddress]);
    const gasLimit = await this._transactionManager.attemptEstimateGas(
      'AddRelayWorkers',
      addRelayWorkerMethod,
      this._managerAddress
    );
    const details: SendTransactionDetails = {
      signer: this._managerAddress,
      gasLimit,
      serverAction: ServerAction.ADD_WORKER,
      method: addRelayWorkerMethod,
      destination: this._hubAddress,
      creationBlockNumber: currentBlock,
    };
    const { txHash } = await this._transactionManager.sendTransaction(details);

    return txHash;
  }

  // TODO: extract worker registration sub-flow
  async attemptRegistration(currentBlock: number): Promise<string[]> {
    const allPrerequisitesOk =
      this.isStakeLocked &&
      this._stakeRequired.isSatisfied &&
      this._balanceRequired.isSatisfied;
    if (!allPrerequisitesOk) {
      log.info(
        'Not all prerequisites for registration are met yet. Registration attempt cancelled'
      );

      return [];
    }

    let transactions: string[] = [];
    // add worker only if not already added
    const workersAdded = this._isWorkerAdded;
    const addWorkersPending = await this._txStoreManager.isActionPending(
      ServerAction.ADD_WORKER
    );
    if (!(workersAdded || addWorkersPending)) {
      const txHash = await this.addRelayWorker(currentBlock);
      transactions = transactions.concat(txHash);
    }

    const {
      app: { url: serverUrl },
    } = getServerConfig();

    const relayHub = getRelayHub(this._hubAddress);

    const registerMethod =
      await relayHub.populateTransaction.registerRelayServer(serverUrl);
    const gasLimit = await this._transactionManager.attemptEstimateGas(
      'RegisterRelay',
      registerMethod,
      this._managerAddress
    );

    const details: SendTransactionDetails = {
      serverAction: ServerAction.REGISTER_SERVER,
      gasLimit,
      signer: this._managerAddress,
      method: registerMethod,
      destination: this._hubAddress,
      creationBlockNumber: currentBlock,
    };
    const { txHash } = await this._transactionManager.sendTransaction(details);
    transactions = transactions.concat(txHash);
    log.debug(
      `Relay ${this._managerAddress} registered on hub ${this._hubAddress}. `
    );

    return transactions;
  }

  private async _sendManagerEthBalanceToOwner(
    currentBlock: number
  ): Promise<string[]> {
    const transactionHashes: string[] = [];

    if (!this._ownerAddress) {
      log.warn('owner is still not setted up');

      return transactionHashes;
    }

    const provider = getProvider();

    const gasPrice = await provider.getGasPrice();
    const gasLimit = BigNumber.from(minTxGasCost ?? 21000);
    const txCost = gasLimit.mul(gasPrice);

    const managerBalance = await provider.getBalance(this._managerAddress);

    if (managerBalance.lt(txCost)) {
      log.error(
        `manager balance too low: ${managerBalance.toString()}, tx cost: ${txCost.toString()}`
      );

      return transactionHashes;
    }

    // sending manager RBTC balance to owner
    const value = managerBalance.sub(txCost);
    log.info(
      `Sending manager RBTC balance ${managerBalance.toString()} to owner`
    );
    const details: SendTransactionDetails = {
      signer: this._managerAddress,
      serverAction: ServerAction.VALUE_TRANSFER,
      destination: this._ownerAddress,
      gasLimit,
      gasPrice,
      value,
      creationBlockNumber: currentBlock,
    };

    const { txHash } = await this._transactionManager.sendTransaction(details);
    transactionHashes.push(txHash);

    return transactionHashes;
  }

  private async _sendWorkersEthBalancesToOwner(
    currentBlock: number
  ): Promise<string[]> {
    const transactionHashes: string[] = [];

    if (!this._ownerAddress) {
      log.warn('owner is still not setted up');

      return transactionHashes;
    }

    const provider = getProvider();
    const gasPrice = await provider.getGasPrice();
    const gasLimit = BigNumber.from(minTxGasCost ?? 21000);
    const txCost = gasPrice.mul(gasLimit);

    const workerBalance = await provider.getBalance(this._workerAddress);
    if (workerBalance.lt(txCost)) {
      log.info(
        `balance too low: ${workerBalance.toString()}, tx cost: ${txCost.toString()}`
      );

      return transactionHashes;
    }

    // sending workers' balance to owner (currently one worker, todo: extend to multiple)
    const value = workerBalance.sub(txCost);
    log.info(
      `Sending workers' RBTC balance ${workerBalance.toString()} to owner`
    );
    const details: SendTransactionDetails = {
      signer: this._workerAddress,
      serverAction: ServerAction.VALUE_TRANSFER,
      destination: this._ownerAddress,
      gasLimit,
      gasPrice,
      value,
      creationBlockNumber: currentBlock,
    };

    const { txHash } = await this._transactionManager.sendTransaction(details);
    transactionHashes.push(txHash);

    return transactionHashes;
  }

  // the hub rejects adding a worker that already has any manager entry, enabled or not
  private async _isWorkerAssigned(blockTag: number): Promise<boolean> {
    const relayHub = getRelayHub(this._hubAddress);
    const managerEntry = BigNumber.from(
      await relayHub.workerToManager(this._workerAddress, { blockTag })
    );
    if (managerEntry.isZero()) {
      return false;
    }
    const enabledEntry = BigNumber.from(this._managerAddress).shl(4).or(1);
    if (!managerEntry.eq(enabledEntry)) {
      log.warn(
        `Worker ${this._workerAddress} is disabled or assigned to another manager`
      );
    }

    return true;
  }

  isRegistered(): boolean {
    const isRegistrationCorrect = this._isRegistrationCorrect();

    return (
      this._stakeRequired.isSatisfied &&
      this.isStakeLocked &&
      isRegistrationCorrect
    );
  }

  printNotRegisteredMessage(): void {
    if (this._isRegistrationCorrect()) {
      return;
    }
    const message = `\nNot registered yet. Prerequisites:
${this._balanceRequired.description}
${this._stakeRequired.description}
Stake locked   | ${boolString(this.isStakeLocked)}
Manager        | ${this._managerAddress}
Worker         | ${this._workerAddress}
Owner          | ${this._ownerAddress ?? chalk.red('k256')}
`;
    log.info(message);
  }

  printEvents(
    decodedEvents: Array<TypedEvent>,
    { fromBlock }: PastEventOptions
  ): void {
    if (decodedEvents.length === 0) {
      return;
    }
    log.info(
      `Handling ${decodedEvents.length} events emitted since block: ${
        fromBlock?.toString() ?? 0
      }`
    );
    for (const decodedEvent of decodedEvents) {
      log.info(`
Name      | ${decodedEvent.event?.padEnd(25) || ''}
Block     | ${decodedEvent.blockNumber}
TxHash    | ${decodedEvent.transactionHash}
`);
    }
  }
}
