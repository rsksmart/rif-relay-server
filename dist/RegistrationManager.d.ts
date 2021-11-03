/// <reference types="node" />
import { EventData, PastEventOptions } from 'web3-eth-contract';
import { EventEmitter } from 'events';
import { PrefixedHexString } from 'ethereumjs-tx';
import { AmountRequired, ContractInteractor } from '@rsksmart/rif-relay-common';
import { RelayManagerData } from '@rsksmart/rif-relay-contracts';
import { ServerConfigParams } from './ServerConfigParams';
import { TransactionManager } from './TransactionManager';
import { TxStoreManager } from './TxStoreManager';
export interface RelayServerRegistryInfo {
    url: string;
}
export declare class RegistrationManager {
    balanceRequired: AmountRequired;
    stakeRequired: AmountRequired;
    _isStakeLocked: boolean;
    isInitialized: boolean;
    hubAddress: string;
    managerAddress: string;
    workerAddress: string;
    eventEmitter: EventEmitter;
    contractInteractor: ContractInteractor;
    ownerAddress?: string;
    transactionManager: TransactionManager;
    config: ServerConfigParams;
    txStoreManager: TxStoreManager;
    relayData: RelayManagerData;
    lastWorkerAddedTransaction?: EventData;
    private delayedEvents;
    get isStakeLocked(): boolean;
    set isStakeLocked(newValue: boolean);
    constructor(contractInteractor: ContractInteractor, transactionManager: TransactionManager, txStoreManager: TxStoreManager, eventEmitter: EventEmitter, config: ServerConfigParams, managerAddress: string, workerAddress: string);
    init(): Promise<void>;
    handlePastEvents(hubEventsSinceLastScan: EventData[], lastScannedBlock: number, currentBlock: number, forceRegistration: boolean): Promise<PrefixedHexString[]>;
    getRelayData(): Promise<RelayManagerData>;
    _extractDuePendingEvents(currentBlock: number): EventData[];
    _isRegistrationCorrect(): boolean;
    _parseEvent(event: {
        events: any[];
        name: string;
        address: string;
    } | null): any;
    _handleStakeWithdrawnEvent(dlog: EventData, currentBlock: number): Promise<PrefixedHexString[]>;
    _handleStakeUnlockedEvent(dlog: EventData, currentBlock: number): Promise<PrefixedHexString[]>;
    /**
     * @param withdrawManager - whether to send the relay manager's balance to the owner.
     *        Note that more than one relay process could be using the same manager account.
     * @param currentBlock
     */
    withdrawAllFunds(withdrawManager: boolean, currentBlock: number): Promise<PrefixedHexString[]>;
    refreshBalance(): Promise<void>;
    refreshStake(): Promise<void>;
    addRelayWorker(currentBlock: number): Promise<PrefixedHexString>;
    attemptRegistration(currentBlock: number): Promise<PrefixedHexString[]>;
    _sendManagerEthBalanceToOwner(currentBlock: number): Promise<PrefixedHexString[]>;
    _sendWorkersEthBalancesToOwner(currentBlock: number): Promise<PrefixedHexString[]>;
    _queryLatestWorkerAddedEvent(): Promise<EventData | undefined>;
    _isWorkerValid(): boolean;
    isRegistered(): Promise<boolean>;
    printNotRegisteredMessage(): void;
    printEvents(decodedEvents: EventData[], options: PastEventOptions): void;
}
