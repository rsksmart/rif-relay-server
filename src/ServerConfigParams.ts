import config from 'config';
import type { LogLevelNumbers } from 'loglevel';

import type { KeyManager } from './KeyManager';
import type { TxStoreManager } from './TxStoreManager';
import { validateAddress } from './Utils';

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
  versionRegistryAddress: string;
  relayHubAddress: string;
  deployVerifierAddress: string;
  relayVerifierAddress: string;
  relayHubId: string;
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

// TODO: is there a way to merge the typescript definition ServerConfigParams with the runtime checking ConfigParamTypes ?
type ServerConfigParams = {
  app: AppConfig;
  contracts: ContractsConfig;
  blockchain: BlockchainConfig;
};

interface ServerDependencies {
  // TODO: rename as this name is terrible
  managerKeyManager: KeyManager;
  workersKeyManager: KeyManager;
  txStoreManager: TxStoreManager;
}

const ERROR_DISABLE_SPONSOR_TX_NOT_CONFIGURED =
  'The param disableSponsoredTx should be properly configured. Valid values are true or false.';
const ERROR_GAS_FEE_PERCENTAGE_NEGATIVE =
  'Param gasFeePercentage can not be a negative value';
const ERROR_FIXED_USD_FEE_NEGATIVE =
  'Param fixedUsdFee can not be a negative value';

// resolve params, and validate the resulting struct
// TODO validate if the relayHub address can be obtain from the versionRegistry
function verifyServerConfiguration({
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

  const { disableSponsoredTx, gasFeePercentage, fixedUsdFee } = app;

  //disableSponsoredTx should be defined
  if (![true, false].includes(disableSponsoredTx))
    throw new Error(ERROR_DISABLE_SPONSOR_TX_NOT_CONFIGURED);

  if (disableSponsoredTx) {
    //gasFeePercentage can not be a negative number
    if (typeof gasFeePercentage == 'number' && gasFeePercentage < 0)
      throw new Error(ERROR_GAS_FEE_PERCENTAGE_NEGATIVE);

    //fixedUsdFee can not be a negative number
    if (typeof fixedUsdFee == 'number' && fixedUsdFee < 0)
      throw new Error(ERROR_FIXED_USD_FEE_NEGATIVE);
  }
}

function getServerConfig(): ServerConfigParams {
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

export {
  AppConfig,
  ContractsConfig,
  BlockchainConfig,
  ServerConfigParams,
  ServerDependencies,
  ERROR_DISABLE_SPONSOR_TX_NOT_CONFIGURED,
  ERROR_GAS_FEE_PERCENTAGE_NEGATIVE,
  ERROR_FIXED_USD_FEE_NEGATIVE,
  verifyServerConfiguration,
  getServerConfig,
};
