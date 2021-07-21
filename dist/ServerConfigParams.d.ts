import { ContractInteractor, ServerConfigParams } from '@rsksmart/rif-relay-common';
import { KeyManager } from './KeyManager';
import { TxStoreManager } from './TxStoreManager';
export interface ServerDependencies {
    managerKeyManager: KeyManager;
    workersKeyManager: KeyManager;
    contractInteractor: ContractInteractor;
    txStoreManager: TxStoreManager;
}
export declare function filterType(config: any, type: string): any;
export declare function entriesToObj(entries: any[]): any;
export declare function filterMembers(env: any, config: any): any;
/**
 * initialize each parameter from commandline, env or config file (in that order)
 * config file must be provided either as command-line or env (obviously, not in
 * the config file..)
 */
export declare function parseServerConfig(args: string[], env: any): any;
export declare function resolveServerConfig(config: Partial<ServerConfigParams>, web3provider: any): Promise<Partial<ServerConfigParams>>;
export declare function configureServer(partialConfig: Partial<ServerConfigParams>): ServerConfigParams;
