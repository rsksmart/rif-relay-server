import { ContractInteractor } from '@rsksmart/rif-relay-common';
import { KeyManager } from './KeyManager';
import { TxStoreManager } from './TxStoreManager';
import { LogLevelNumbers } from 'loglevel';
export interface ServerConfigParams {
    url: string;
    port: number;
    versionRegistryAddress: string;
    versionRegistryDelayPeriod?: number;
    relayHubId?: string;
    relayHubAddress: string;
    rskNodeUrl: string;
    workdir: string;
    checkInterval: number;
    readyTimeout: number;
    devMode: boolean;
    customReplenish: boolean;
    registrationBlockRate: number;
    alertedBlockDelay: number;
    minAlertedDelayMS: number;
    maxAlertedDelayMS: number;
    trustedVerifiers: string[];
    gasPriceFactor: number;
    logLevel: LogLevelNumbers;
    deployVerifierAddress: string;
    relayVerifierAddress: string;
    workerMinBalance: number;
    workerTargetBalance: number;
    managerMinBalance: number;
    managerMinStake: string;
    managerTargetBalance: number;
    minHubWithdrawalBalance: number;
    refreshStateTimeoutBlocks: number;
    pendingTransactionTimeoutBlocks: number;
    successfulRoundsForReady: number;
    confirmationsNeeded: number;
    retryGasPriceFactor: number;
    maxGasPrice: string;
    defaultGasLimit: number;
    estimateGasFactor: number;
    allowForSponsoredTx: boolean;
}
export interface ServerDependencies {
    managerKeyManager: KeyManager;
    workersKeyManager: KeyManager;
    contractInteractor: ContractInteractor;
    txStoreManager: TxStoreManager;
}
export declare function filterType(config: any, type: string): any;
export declare function entriesToObj(entries: any[]): any;
export declare function filterMembers(env: any, config: any): any;
export declare function explicitType([key, val]: [string, any]): any;
/**
 * initialize each parameter from commandline, env or config file (in that order)
 * config file must be provided either as command-line or env (obviously, not in
 * the config file..)
 */
export declare function parseServerConfig(args: string[], env: any): any;
export declare function resolveServerConfig(config: Partial<ServerConfigParams>, web3provider: any): Promise<Partial<ServerConfigParams>>;
export declare function configureServer(partialConfig: Partial<ServerConfigParams>): ServerConfigParams;
