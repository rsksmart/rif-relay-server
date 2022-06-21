/// <reference types="@openeth/truffle-typings" />
/// <reference types="bn.js" />
/// <reference types="node" />
import { EventData } from 'web3-eth-contract';
import { PrefixedHexString } from 'ethereumjs-tx';
import { IRelayHubInstance } from '@rsksmart/rif-relay-contracts/types/truffle-contracts';
import { ContractInteractor, PingResponse, AmountRequired, TokenResponse, VerifierResponse, DeployTransactionRequest, RelayTransactionRequest } from '@rsksmart/rif-relay-common';
import { RegistrationManager } from './RegistrationManager';
import { SignedTransactionDetails, TransactionManager } from './TransactionManager';
import { TxStoreManager } from './TxStoreManager';
import { ServerDependencies, ServerConfigParams } from './ServerConfigParams';
import EventEmitter from 'events';
export declare class RelayServer extends EventEmitter {
    lastScannedBlock: number;
    lastRefreshBlock: number;
    ready: boolean;
    lastSuccessfulRounds: number;
    readonly managerAddress: PrefixedHexString;
    readonly workerAddress: PrefixedHexString;
    gasPrice: number;
    _workerSemaphoreOn: boolean;
    alerted: boolean;
    alertedBlock: number;
    private initialized;
    readonly contractInteractor: ContractInteractor;
    private readonly versionManager;
    private workerTask?;
    config: ServerConfigParams;
    transactionManager: TransactionManager;
    txStoreManager: TxStoreManager;
    lastMinedActiveTransaction?: EventData;
    registrationManager: RegistrationManager;
    chainId: number;
    networkId: number;
    relayHubContract: IRelayHubInstance;
    trustedVerifiers: Set<string | undefined>;
    workerBalanceRequired: AmountRequired;
    private readonly customReplenish;
    constructor(config: Partial<ServerConfigParams>, dependencies: ServerDependencies);
    printServerAddresses(): void;
    getMinGasPrice(): number;
    isCustomReplenish(): boolean;
    pingHandler(verifier?: string): Promise<PingResponse>;
    tokenHandler(verifier?: string): Promise<TokenResponse>;
    verifierHandler(): Promise<VerifierResponse>;
    isDeployRequest(req: any): boolean;
    validateInputTypes(req: RelayTransactionRequest | DeployTransactionRequest): void;
    validateInput(req: RelayTransactionRequest | DeployTransactionRequest): void;
    validateVerifier(req: RelayTransactionRequest | DeployTransactionRequest): void;
    validateMaxNonce(relayMaxNonce: number): Promise<void>;
    validateRequestWithVerifier(req: RelayTransactionRequest | DeployTransactionRequest): Promise<{
        maxPossibleGas: BN;
    }>;
    getMaxPossibleGas(req: RelayTransactionRequest | DeployTransactionRequest, isDeployRequest: boolean): Promise<import("bn.js")>;
    validateViewCallSucceeds(method: any, req: RelayTransactionRequest | DeployTransactionRequest, maxPossibleGas: BN): Promise<void>;
    createRelayTransaction(req: RelayTransactionRequest | DeployTransactionRequest): Promise<SignedTransactionDetails>;
    intervalHandler(): Promise<void>;
    start(): void;
    stop(): void;
    _workerSemaphore(blockNumber: number): Promise<void>;
    fatal(message: string): void;
    /***
     * initialize data from trusted verifiers.
     * "Trusted" verifiers means that:
     * - we trust verifyRelayedCall to be consistent: off-chain call and on-chain calls should either both succeed
     *    or both revert.
     *
     * @param verifiers list of trusted verifiers addresses
     */
    _initTrustedVerifiers(verifiers?: string[]): Promise<void>;
    init(): Promise<void>;
    /**
     * It withdraws excess balance from the relayHub to the relayManager, and refills the relayWorker with
     * balance if required.
     * @param workerIndex Not used so it can be any number
     * @param currentBlock Where to place the replenish action
     */
    replenishServer(workerIndex: number, currentBlock: number): Promise<PrefixedHexString[]>;
    _worker(blockNumber: number): Promise<PrefixedHexString[]>;
    _refreshGasPrice(): Promise<void>;
    _handleChanges(currentBlockNumber: number): Promise<PrefixedHexString[]>;
    getManagerBalance(): Promise<BN>;
    getWorkerBalance(workerIndex: number): Promise<BN>;
    _shouldRegisterAgain(currentBlock: number, hubEventsSinceLastScan: EventData[]): Promise<boolean>;
    _shouldRefreshState(currentBlock: number): boolean;
    handlePastHubEvents(currentBlockNumber: number, hubEventsSinceLastScan: EventData[]): Promise<void>;
    getAllHubEventsSinceLastScan(): Promise<EventData[]>;
    _handleTransactionRelayedEvent(event: EventData): Promise<void>;
    _handleTransactionRejectedByRecipientEvent(blockNumber: number): Promise<void>;
    _getLatestTxBlockNumber(): number;
    _updateLatestTxBlockNumber(eventsSinceLastScan: EventData[]): Promise<void>;
    _queryLatestActiveEvent(): Promise<EventData | undefined>;
    /**
     * Resend all outgoing pending transactions with insufficient gas price by all signers (manager, workers)
     * @return the mapping of the previous transaction hash to details of a new boosted transaction
     */
    _boostStuckPendingTransactions(blockNumber: number): Promise<Map<PrefixedHexString, SignedTransactionDetails>>;
    _boostStuckTransactionsForManager(blockNumber: number): Promise<Map<PrefixedHexString, SignedTransactionDetails>>;
    _boostStuckTransactionsForWorker(blockNumber: number, workerIndex: number): Promise<Map<PrefixedHexString, SignedTransactionDetails>>;
    isTrustedVerifier(verifier: string): boolean;
    isReady(): boolean;
    setReadyState(isReady: boolean): void;
}
