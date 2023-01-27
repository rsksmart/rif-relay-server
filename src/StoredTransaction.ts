import type { BigNumber, PopulatedTransaction } from 'ethers';

export enum ServerAction {
  REGISTER_SERVER,
  ADD_WORKER,
  RELAY_CALL,
  VALUE_TRANSFER,
  DEPOSIT_WITHDRAWAL,
  PENALIZATION,
}

export interface StoredTransactionMetadata {
  readonly txId: string;
  readonly from: string;
  readonly attempts: number;
  readonly serverAction: ServerAction;
  readonly creationBlockNumber: number;
  readonly boostBlockNumber?: number;
  readonly minedBlockNumber?: number;
}

export interface StoredTransactionSerialized {
  readonly to: string | undefined;
  readonly gasLimit: BigNumber | undefined;
  readonly gasPrice: BigNumber | undefined;
  readonly data: string | undefined;
  readonly nonce: number | undefined;
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
  tx: PopulatedTransaction,
  metadata: StoredTransactionMetadata
): StoredTransaction {
  //TODO check what to do if the gasLimit and gasPrice its zero
  const details: StoredTransactionSerialized = {
    to: tx.to,
    gasLimit: tx.gasLimit,
    gasPrice: tx.gasPrice,
    data: tx.data,
    nonce: tx.nonce,
  };

  return Object.assign({}, details, metadata);
}
