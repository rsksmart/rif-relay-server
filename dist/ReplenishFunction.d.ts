import { PrefixedHexString } from 'ethereumjs-tx/dist/types';
import { RelayServer } from './RelayServer';
export declare function replenishStrategy(relayServer: RelayServer, workerIndex: number, currentBlock: number): Promise<PrefixedHexString[]>;
