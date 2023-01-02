import type { ContractInteractor } from '@rsksmart/rif-relay-common';

import { constants } from 'ethers';
import type { LogLevelNumbers } from 'loglevel';

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
  contractInteractor: ContractInteractor;
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
    requestMinValidSeconds: 43200,
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
    retryGasPriceFactor: '1.2',
    defaultGasLimit: 500000,
    maxGasPrice: 100e9,
    estimateGasFactor: '1.2',
  },
};

// helper function: throw and never return..
function error(err: string): never {
  throw new Error(err);
}

// resolve params, and validate the resulting struct
export async function resolveServerConfig(
  contractsConfig: ContractsConfig,
  appConfig: AppConfig,
  contractInteractor: ContractInteractor
): Promise<ServerConfigParams> {
  /* if (contractsConfig.versionRegistryAddress != null) {
        if (contractsConfig.relayHubAddress != null) {
            error(
                'missing param: must have either relayHubAddress or versionRegistryAddress'
            );
        }
        const relayHubId = contractsConfig.relayHubId ??
            error('missing param: relayHubId to read from VersionRegistry');
        validateAddress(
            contractsConfig.versionRegistryAddress,
            'Invalid param versionRegistryAddress: '
        );
        if (
            !(await contractInteractor.isContractDeployed(
                contractsConfig.versionRegistryAddress
            ))
        ) {
            error(
                'Invalid param versionRegistryAddress: no contract at address ' +
                contractsConfig.versionRegistryAddress
            );
        }

        const versionRegistry = new VersionRegistry(
            web3provider,
            contractsConfig.versionRegistryAddress
        );
        const { version, value, time } = await versionRegistry.getVersion(
            relayHubId,
            appConfig.versionRegistryDelayPeriod ?? defaultRegistryDelayPeriod
        );
        validateAddress(
            value,
            `Invalid param relayHubId ${relayHubId} @ ${version}: not an address:`
        );

        log.info(
            `Using RelayHub ID:${relayHubId} version:${version} address:${value} . created at: ${new Date(
                time * 1000
            ).toString()}`
        );
        contractsConfig.relayHubAddress = value;
    } else { */
  if (contractsConfig.relayHubAddress == null) {
    error(
      'missing param: must have either relayHubAddress or versionRegistryAddress'
    );
  }
  validateAddress(
    contractsConfig.relayHubAddress,
    'invalid param: "relayHubAddress" is not a valid address:'
  );
  /*  } */

  if (
    !(await contractInteractor.isContractDeployed(
      contractsConfig.relayHubAddress
    ))
  ) {
    error(
      `RelayHub: no contract at address ${contractsConfig.relayHubAddress}`
    );
  }
  if (appConfig.url == null) error('missing param: url');
  if (appConfig.workdir == null) error('missing param: workdir');

  return { ...serverDefaultConfiguration, ...contractsConfig, ...appConfig };
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
