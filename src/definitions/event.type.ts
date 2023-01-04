import type { RelayHub } from '@rsksmart/rif-relay-contracts';

export type BlockTag =
  | number
  | string
  | 'latest'
  | 'pending'
  | 'earliest'
  | 'genesis';

export type PastEventOptions = {
  fromBlock?: number;
  toBlock?: BlockTag;
};

export type ManagerEvent = keyof RelayHub['filters'];
export type DefaultManagerEvent = Extract<
  ManagerEvent,
  | 'RelayServerRegistered'
  | 'RelayWorkersAdded'
  | 'TransactionRelayed'
  | 'TransactionRelayedButRevertedByRecipient'
>;

type ManagerEventMethods = RelayHub['filters'][ManagerEvent];

export type ManagerEventParameters = Parameters<ManagerEventMethods>;
