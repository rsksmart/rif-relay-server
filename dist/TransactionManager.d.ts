import { Mutex } from 'async-mutex';
import { PrefixedHexString, Transaction, TransactionOptions } from 'ethereumjs-tx';
import { ContractInteractor } from '@rsksmart/rif-relay-common';
import { TxStoreManager } from './TxStoreManager';
import { KeyManager } from './KeyManager';
import { ServerDependencies, ServerConfigParams } from './ServerConfigParams';
import { ServerAction, StoredTransaction } from './StoredTransaction';
export interface SignedTransactionDetails {
    transactionHash: PrefixedHexString;
    signedTx: PrefixedHexString;
}
export interface SendTransactionDetails {
    signer: string;
    serverAction: ServerAction;
    method?: any;
    destination: string;
    value?: string;
    gasLimit: number;
    gasPrice?: string;
    creationBlockNumber: number;
}
export declare class TransactionManager {
    nonceMutex: Mutex;
    managerKeyManager: KeyManager;
    workersKeyManager: KeyManager;
    contractInteractor: ContractInteractor;
    nonces: Record<string, number>;
    txStoreManager: TxStoreManager;
    config: ServerConfigParams;
    rawTxOptions: TransactionOptions;
    constructor(dependencies: ServerDependencies, config: ServerConfigParams);
    _initNonces(): void;
    _init(): Promise<void>;
    printBoostedTransactionLog(txHash: string, creationBlockNumber: number, gasPrice: number, isMaxGasPriceReached: boolean): void;
    printSendTransactionLog(transaction: Transaction, from: string): void;
    attemptEstimateGas(methodName: string, method: any, from: string): Promise<number>;
    sendTransaction({ signer, method, destination, value, gasLimit, gasPrice, creationBlockNumber, serverAction }: SendTransactionDetails): Promise<SignedTransactionDetails>;
    updateTransactionWithMinedBlock(tx: StoredTransaction, minedBlockNumber: number): Promise<void>;
    updateTransactionWithAttempt(txToSign: Transaction, tx: StoredTransaction, currentBlock: number): Promise<StoredTransaction>;
    resendTransaction(tx: StoredTransaction, currentBlock: number, newGasPrice: number, isMaxGasPriceReached: boolean): Promise<SignedTransactionDetails>;
    _resolveNewGasPrice(oldGasPrice: number): {
        newGasPrice: number;
        isMaxGasPriceReached: boolean;
    };
    pollNonce(signer: string): Promise<number>;
    removeConfirmedTransactions(blockNumber: number): Promise<void>;
    /**
     * This methods uses the oldest pending transaction for reference. If it was not mined in a reasonable time,
     * it is boosted all consequent transactions with gas price lower then that are boosted as well.
     */
    boostUnderpricedPendingTransactionsForSigner(signer: string, currentBlockHeight: number): Promise<Map<PrefixedHexString, SignedTransactionDetails>>;
}
