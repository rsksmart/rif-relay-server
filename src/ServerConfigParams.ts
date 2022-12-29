import { constants } from 'ethers';
import type { LogLevelNumbers } from 'loglevel';

import type { KeyManager } from './KeyManager';
import type { TxStoreManager } from './TxStoreManager';
import config from 'config';

export type AppConfig = {
  url: string;
  port: number;
  workdir: string;
  devMode: boolean;
  customReplenish: boolean;
  logLevel: LogLevelNumbers;
  checkInterval: number;
  readyTimeout: number;
  feePercentage: string;
  disableSponsoredTx: boolean;
  sponsoredDestinations: Array<string>;
};

export type ContractsConfig = {
  versionRegistryAddress: string;
  relayHubAddress: string;
  deployVerifierAddress: string;
  relayVerifierAddress: string;
  relayHubId?: string;
  feesReceiver: string;
  trustedVerifiers: string[];
};

export type BlockchainConfig = {
  rskNodeUrl: string;
  gasPriceFactor: number;
  registrationBlockRate: number;
  alertedBlockDelay: number;
  minAlertedDelayMS: number;
  maxAlertedDelayMS: number;
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
  maxGasPrice: number;
  defaultGasLimit: number;
  estimateGasFactor: number;
  versionRegistryDelayPeriod?: number;
};

// TODO: is there a way to merge the typescript definition ServerConfigParams with the runtime checking ConfigParamTypes ?
export type ServerConfigParams = {
  app: AppConfig;
  contracts: ContractsConfig;
  blockchain: BlockchainConfig;
};

export interface ServerDependencies {
  // TODO: rename as this name is terrible
  managerKeyManager: KeyManager;
  workersKeyManager: KeyManager;
  txStoreManager: TxStoreManager;
}

const serverDefaultConfiguration: ServerConfigParams = {
  app: {
    readyTimeout: 30000,
    devMode: false,
    customReplenish: false,
    logLevel: 1,
    url: 'http://localhost:8090',
    port: 0,
    workdir: '',
    checkInterval: 10000,
    disableSponsoredTx: false,
    feePercentage: '0',
    sponsoredDestinations: [],
  },
  contracts: {
    versionRegistryAddress: constants.AddressZero,
    relayHubAddress: constants.AddressZero,
    relayVerifierAddress: constants.AddressZero,
    deployVerifierAddress: constants.AddressZero,
    feesReceiver: constants.AddressZero,
    trustedVerifiers: [],
  },
  blockchain: {
    rskNodeUrl: '',
    alertedBlockDelay: 0,
    minAlertedDelayMS: 0,
    maxAlertedDelayMS: 0,
    gasPriceFactor: 1,
    registrationBlockRate: 0,
    workerMinBalance: 0.001e18, // 0.001 RBTC
    workerTargetBalance: 0.003e18, // 0.003 RBTC
    managerMinBalance: 0.001e18, // 0.001 RBTC
    managerMinStake: '1', // 1 wei
    managerTargetBalance: 0.003e18, // 0.003 RBTC
    minHubWithdrawalBalance: 0.001e18, // 0.001 RBTC
    refreshStateTimeoutBlocks: 5,
    pendingTransactionTimeoutBlocks: 30, // around 5 minutes with 10 seconds block times
    successfulRoundsForReady: 3, // successful mined blocks to become ready after exception
    confirmationsNeeded: 12,
    retryGasPriceFactor: 1.2,
    defaultGasLimit: 500000,
    maxGasPrice: 100e9,
    estimateGasFactor: 1.2,
  },
};

export function configureServer(
  contractsConfig: ContractsConfig,
  appConfig: AppConfig,
  blockchainConfig: BlockchainConfig
): ServerConfigParams {
  const contracts = Object.assign(
    serverDefaultConfiguration.contracts,
    contractsConfig
  );
  const app = Object.assign(serverDefaultConfiguration.app, appConfig);
  const blockchain = Object.assign(
    serverDefaultConfiguration.blockchain,
    blockchainConfig
  );
  const config: ServerConfigParams = {
    app,
    contracts,
    blockchain,
  };

  return config;
}

// TODO configuration validations
export function getServerConfig(): ServerConfigParams {
  const contractsConfig = config.get<ContractsConfig>('contracts');
  const appConfig = config.get<AppConfig>('app');
  const blockchainConfig = config.get<BlockchainConfig>('blockchain');

  return configureServer(contractsConfig, appConfig, blockchainConfig);
}
