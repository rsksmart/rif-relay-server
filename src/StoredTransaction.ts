import { PrefixedHexString, Transaction } from 'ethereumjs-tx';
import * as ethUtils from 'ethereumjs-util';

export enum ServerAction {
    REGISTER_SERVER,
    ADD_WORKER,
    RELAY_CALL,
    VALUE_TRANSFER,
    DEPOSIT_WITHDRAWAL,
    PENALIZATION
}

export interface StoredTransactionMetadata {
    readonly from: string;
    readonly attempts: number;
    readonly serverAction: ServerAction;
    readonly creationBlockNumber: number;
    readonly boostBlockNumber?: number;
    readonly minedBlockNumber?: number;
}

export interface StoredTransactionSerialized {
    readonly to: string;
    readonly gas: number;
    readonly gasPrice: number;
    readonly data: PrefixedHexString;
    readonly nonce: number;
    readonly txId: PrefixedHexString;
}

export interface NonceSigner {
    nonceSigner?: {
        nonce: number;
        signer: string;
    };
}

export type StoredTransaction = StoredTransactionSerialized &
    StoredTransactionMetadata &
    NonceSigner;

/**
 * Make sure not to pass {@link StoredTransaction} as {@param metadata}, as it will override fields from {@param tx}!
 * @param tx
 * @param metadata
 */
export function createStoredTransaction(
    tx: Transaction,
    metadata: StoredTransactionMetadata
): StoredTransaction {
    const details: StoredTransactionSerialized = {
        to: ethUtils.bufferToHex(tx.to),
        gas: ethUtils.bufferToInt(tx.gasLimit),
        gasPrice: ethUtils.bufferToInt(tx.gasPrice),
        data: ethUtils.bufferToHex(tx.data),
        nonce: ethUtils.bufferToInt(tx.nonce),
        txId: ethUtils.bufferToHex(tx.hash())
    };
    return Object.assign({}, details, metadata);
}
