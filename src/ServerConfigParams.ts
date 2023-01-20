import config from 'config';
import type { LogLevelNumbers } from 'loglevel';

import type { KeyManager } from './KeyManager';
import type { TxStoreManager } from './TxStoreManager';
import { validateAddress } from './Utils';

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
  relayHubId: string;
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

  //TODO: validate blockchain.rskNodeUrl is a valid URL (and other properties)

  if (!app.url) throw new Error('missing param: url');
  if (!app.port) throw new Error('missing param: port');
  if (!app.workdir) throw new Error('missing param: workdir');
}

export function getServerConfig(): ServerConfigParams {
  if (
    !(config.has('contracts') && config.has('app') && config.has('blockchain'))
  ) {
    throw new Error(
      'missing configurations for relay server. Please consult your config file in the config folder.'
    );
  }

  const configuration: ServerConfigParams = {
    contracts: config.get('contracts'),
    app: config.get('app'),
    blockchain: config.get('blockchain'),
  };

  verifyServerConfiguration(configuration);

  return configuration;
}
