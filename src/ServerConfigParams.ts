import { constants } from 'ethers';
import type { LogLevelNumbers } from 'loglevel';
import config from 'config';

import { validateAddress } from './Utils';
import type { KeyManager } from './KeyManager';
import type { TxStoreManager } from './TxStoreManager';

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
  requestMinValidSeconds: number;
};

export type ContractsConfig = {
  versionRegistryAddress: string;
  relayHubAddress: string;
  deployVerifierAddress: string;
  relayVerifierAddress: string;
  smartWalletFactoryAddress: string;
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
  managerMinStake: number;
  managerTargetBalance: number;
  minHubWithdrawalBalance: number;
  refreshStateTimeoutBlocks: number;
  pendingTransactionTimeoutBlocks: number;
  successfulRoundsForReady: number;
  confirmationsNeeded: number;
  retryGasPriceFactor: string;
  maxGasPrice: number;
  defaultGasLimit: number;
  estimateGasFactor: string;
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
    checkInterval: 1000,
    disableSponsoredTx: false,
    feePercentage: '0',
    sponsoredDestinations: [],
    requestMinValidSeconds: 43200,
  },
  contracts: {
    versionRegistryAddress: constants.AddressZero,
    relayHubAddress: constants.AddressZero,
    relayVerifierAddress: constants.AddressZero,
    deployVerifierAddress: constants.AddressZero,
    smartWalletFactoryAddress: constants.AddressZero,
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
    managerMinStake: 1, // 1 wei
    managerTargetBalance: 0.003e18, // 0.003 RBTC
    minHubWithdrawalBalance: 0.001e18, // 0.001 RBTC
    refreshStateTimeoutBlocks: 5,
    pendingTransactionTimeoutBlocks: 30, // around 5 minutes with 10 seconds block times
    successfulRoundsForReady: 3, // successful mined blocks to become ready after exception
    confirmationsNeeded: 12,
    retryGasPriceFactor: '1.2',
    defaultGasLimit: 500000,
    maxGasPrice: 100e9,
    estimateGasFactor: '1.2',
  },
};

// resolve params, and validate the resulting struct
// TODO validate if the relayHub address can be obtain from the versionRegistry
export function verifyServerConfiguration({
  app,
  contracts,
}: ServerConfigParams): void {
  if (!contracts.relayHubAddress) {
    throw new Error(
      'missing param: must have either relayHubAddress or versionRegistryAddress'
    );
  }
  validateAddress(
    contracts.relayHubAddress,
    'invalid param: "relayHubAddress" is not a valid address:'
  );

  if (!app.url) throw new Error('missing param: url');
  if (!app.port) throw new Error('missing param: port');
  if (!app.workdir) throw new Error('missing param: workdir');
}

//FIXME: the incomming and outgoing type may and likely should differ. For example for all big number values the incoming value should be a string to prevent loss of precision, but outgoing type should be big number so that it doesn't need to be converted everywhere it is used.
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

export function getServerConfig(): ServerConfigParams {
  const contractsConfig: ContractsConfig = config.get('contracts');
  const appConfig: AppConfig = config.get('app');
  const blockchainConfig: BlockchainConfig = config.get('blockchain');

  const configuration = configureServer(
    contractsConfig,
    appConfig,
    blockchainConfig
  );

  verifyServerConfiguration(configuration);

  return configuration;
}
