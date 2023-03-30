import config from 'config';

import type { KeyManager } from './KeyManager';
import type { TxStoreManager } from './TxStoreManager';
import type { LogLevelNumbers } from 'loglevel';
import { serverConfigSchema } from './serverConfigParamsUtils';
import {
  ERROR_GAS_FEE_PERCENTAGE_NEGATIVE,
  ERROR_FIXED_USD_FEE_NEGATIVE,
} from './definitions/errorMessages.const';

type AppConfig = {
  url: string;
  port: number;
  workdir: string;
  devMode: boolean;
  customReplenish: boolean;
  logLevel: LogLevelNumbers;
  checkInterval: number;
  readyTimeout: number;
  gasFeePercentage: number;
  disableSponsoredTx: boolean;
  sponsoredDestinations: Array<string>;
  requestMinValidSeconds: number;
  transferFeePercentage: number;
  fixedUsdFee: number;
};

type ContractsConfig = {
  relayHubAddress: string;
  deployVerifierAddress: string;
  relayVerifierAddress: string;
  feesReceiver: string;
  trustedVerifiers: string[];
};

type BlockchainConfig = {
  rskNodeUrl: string;
  gasPriceFactor: number;
  registrationBlockRate: number;
  alertedBlockDelay: number;
  minAlertedDelayMS: number;
  maxAlertedDelayMS: number;
  workerMinBalance: string | number;
  workerTargetBalance: string | number;
  managerMinBalance: string | number;
  managerMinStake: string | number;
  managerTargetBalance: string | number;
  minHubWithdrawalBalance: string | number;
  refreshStateTimeoutBlocks: number;
  pendingTransactionTimeoutBlocks: number;
  successfulRoundsForReady: number;
  confirmationsNeeded: number;
  retryGasPriceFactor: string;
  maxGasPrice: string | number;
  defaultGasLimit: string | number;
  estimateGasFactor: number;
  versionRegistryDelayPeriod?: number;
};

type RegisterConfig = {
  stake: string | number;
  funds: string | number;
  mnemonic?: string;
  privateKey?: string;
  relayHub?: string;
  gasPrice: string | number;
  unstakeDelay: string | number;
};

// TODO: is there a way to merge the typescript definition ServerConfigParams with the runtime checking ConfigParamTypes ?
type ServerConfigParams = {
  app: AppConfig;
  contracts: ContractsConfig;
  blockchain: BlockchainConfig;
  register: RegisterConfig;
};

interface ServerDependencies {
  // TODO: rename as this name is terrible
  managerKeyManager: KeyManager;
  workersKeyManager: KeyManager;
  txStoreManager: TxStoreManager;
}

// TODO validate if the relayHub address can be obtain from the versionRegistry
function verifyServerConfiguration(): void {
  const validation = serverConfigSchema.validate(config);

  if (validation.error) {
    throw new Error(`Server configuration error:  ${validation.error.message}`);
  }

  //Conditional validations

  const appConfig: AppConfig = config.get('app');
  const { disableSponsoredTx, gasFeePercentage, fixedUsdFee } = appConfig;

  if (disableSponsoredTx) {
    //gasFeePercentage can not be a negative number
    if (gasFeePercentage < 0)
      throw new Error(ERROR_GAS_FEE_PERCENTAGE_NEGATIVE);

    //fixedUsdFee can not be a negative number
    if (fixedUsdFee < 0) throw new Error(ERROR_FIXED_USD_FEE_NEGATIVE);
  }
}

function getServerConfig(): ServerConfigParams {
  verifyServerConfiguration();

  const serverConfig: ServerConfigParams = {
    contracts: config.get('contracts'),
    app: config.get('app'),
    blockchain: config.get('blockchain'),
    register: config.get('register'),
  };

  return serverConfig;
}

export {
  AppConfig,
  ContractsConfig,
  BlockchainConfig,
  RegisterConfig,
  ServerConfigParams,
  ServerDependencies,
  verifyServerConfiguration,
  getServerConfig,
};
