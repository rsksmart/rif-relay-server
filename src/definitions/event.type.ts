import type { RelayHub } from '@rsksmart/rif-relay-contracts';

export type LatestTag = 'latest';

export type PastEventOptions = {
  fromBlock?: number;
  toBlock?: LatestTag | number;
};

export type ManagerEvent = keyof RelayHub['filters'];
export type DefaultManagerEvent = Extract<
  ManagerEvent,
  | 'RelayServerRegistered'
  | 'RelayWorkersAdded'
  | 'TransactionRelayed'
  | 'TransactionRelayedButRevertedByRecipient'
>;
