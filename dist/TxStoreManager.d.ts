import { PrefixedHexString } from 'ethereumjs-tx';
import { ServerAction, StoredTransaction } from './StoredTransaction';
export declare const TXSTORE_FILENAME = "txstore.db";
export declare class TxStoreManager {
    private readonly txstore;
    constructor({ workdir, inMemory }: {
        workdir?: string;
        inMemory?: boolean;
    });
    putTx(tx: StoredTransaction, updateExisting?: boolean): Promise<void>;
    /**
     * Only for testing
     */
    getTxByNonce(signer: PrefixedHexString, nonce: number): Promise<StoredTransaction>;
    /**
     * Only for testing
     */
    getTxById(txId: string): Promise<StoredTransaction>;
    getTxsUntilNonce(signer: PrefixedHexString, nonce: number): Promise<StoredTransaction[]>;
    removeTxsUntilNonce(signer: PrefixedHexString, nonce: number): Promise<unknown>;
    clearAll(): Promise<void>;
    getAllBySigner(signer: PrefixedHexString): Promise<StoredTransaction[]>;
    getAll(): Promise<StoredTransaction[]>;
    isActionPending(serverAction: ServerAction, destination?: string | undefined): Promise<boolean>;
}
