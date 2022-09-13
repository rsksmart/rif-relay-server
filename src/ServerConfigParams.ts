import { configure } from '@rsksmart/rif-relay-client';
import {
    constants,
    ContractInteractor,
    VersionRegistry
} from '@rsksmart/rif-relay-common';
import * as fs from 'fs';
import parseArgs from 'minimist';
import { KeyManager } from './KeyManager';
import { TxStoreManager } from './TxStoreManager';

//@ts-ignore
import 'dotenv/config';
import log, { LogLevelNumbers } from 'loglevel';
// TODO: had to comment out as it doesn't work. Maybe let's update the dependency ;]
// import sourceMapSupport from 'source-map-support';
//@ts-ignore
// sourceMapSupport.install({ errorFormatterForce: true });

// TODO: is there a way to merge the typescript definition ServerConfigParams with the runtime checking ConfigParamTypes ?
// FIXME: Yes there is with Pattern Matching. Let's create a ticket for refactoring this. We could also move to node config which would make life easier I suspect; see [PP-314](https://rsklabs.atlassian.net/browse/PP-314).
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
    collectorAddress: string;
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
    /**
     * Forces relay users to pay for transaction gas
     * @option false - The smart wallet of the relay user will be charged for the transaction
     * @option true - The relay worker will pay transaction gas.
     */
    disableSponsoredTx: boolean;

    /**
     * Sets the fee value (%) that the server will take from all transactions.
     * This fee will be added to the estimated gas and required in the transaction amount.
     * @option n : {n ∈ ℝ} - absolute value of the fee percentage to be added to gas
     * @note the percentage is represented as a fraction (1 = 100%) string to allow for very low or high percentages
     * @note the minus sign is omitted if used
     * @note fractions exceeding the number of decimals of that of the native currency will be rounded up
     */
    feePercentage: string;
}

export interface ServerDependencies {
    // TODO: rename as this name is terrible
    managerKeyManager: KeyManager;
    workersKeyManager: KeyManager;
    contractInteractor: ContractInteractor;
    txStoreManager: TxStoreManager;
}

export const serverDefaultConfiguration: ServerConfigParams = {
    // FIXME: serverDefaultConfiguration is not obvious and there is no other config. I suggest naming it just: defaultConfiguration
    alertedBlockDelay: 0,
    minAlertedDelayMS: 0,
    maxAlertedDelayMS: 0,
    relayHubAddress: constants.ZERO_ADDRESS,
    relayVerifierAddress: constants.ZERO_ADDRESS,
    deployVerifierAddress: constants.ZERO_ADDRESS,
    collectorAddress: constants.ZERO_ADDRESS,
    trustedVerifiers: [],
    gasPriceFactor: 1,
    registrationBlockRate: 0,
    workerMinBalance: 0.001e18, // 0.001 RBTC
    workerTargetBalance: 0.003e18, // 0.003 RBTC
    managerMinBalance: 0.001e18, // 0.001 RBTC
    managerMinStake: '1', // 1 wei
    managerTargetBalance: 0.003e18, // 0.003 RBTC
    minHubWithdrawalBalance: 0.001e18, // 0.001 RBTC
    checkInterval: 10000,
    readyTimeout: 30000,
    devMode: false,
    customReplenish: false,
    logLevel: 1,
    url: 'http://localhost:8090',
    rskNodeUrl: '',
    port: 0,
    versionRegistryAddress: constants.ZERO_ADDRESS,
    workdir: '',
    refreshStateTimeoutBlocks: 5,
    pendingTransactionTimeoutBlocks: 30, // around 5 minutes with 10 seconds block times
    successfulRoundsForReady: 3, // successful mined blocks to become ready after exception
    confirmationsNeeded: 12,
    retryGasPriceFactor: 1.2,
    defaultGasLimit: 500000,
    maxGasPrice: (100e9).toString(),
    estimateGasFactor: 1.2,
    disableSponsoredTx: false,
    feePercentage: '0'
};

const ConfigParamsTypes = {
    config: 'string',
    url: 'string',
    port: 'number',
    versionRegistryAddress: 'string',
    versionRegistryDelayPeriod: 'number',
    relayHubId: 'string',
    relayHubAddress: 'string',
    gasPriceFactor: 'number',
    rskNodeUrl: 'string',
    workdir: 'string',
    checkInterval: 'number',
    readyTimeout: 'number',
    devMode: 'boolean',
    customReplenish: 'boolean',
    logLevel: 'number',
    registrationBlockRate: 'number',
    alertedBlockDelay: 'number',

    workerMinBalance: 'number',
    workerTargetBalance: 'number',
    managerMinBalance: 'number',
    managerTargetBalance: 'number',
    minHubWithdrawalBalance: 'number',
    defaultGasLimit: 'number',

    trustedVerifiers: 'string',
    relayVerifierAddress: 'string',
    deployVerifierAddress: 'string',
    collectorAddress: 'string',

    disableSponsoredTx: 'boolean',
    feePercentage: 'string'
} as any;

// by default: no waiting period - use VersionRegistry entries immediately.
const DefaultRegistryDelayPeriod = 0;

// helper function: throw and never return..
function error(err: string): never {
    throw new Error(err);
}

// get the keys matching specific type from ConfigParamsType
export function filterType(config: any, type: string): any {
    return Object.entries(config).flatMap((e) => (e[1] === type ? [e[0]] : []));
}

// convert [key,val] array (created by Object.entries) back to an object.
export function entriesToObj(entries: any[]): any {
    return entries.reduce((set: any, [k, v]) => ({ ...set, [k]: v }), {});
}

// filter and return from env only members that appear in "config"
export function filterMembers(env: any, config: any): any {
    return entriesToObj(
        Object.entries(env).filter((e) => config[e[0]] != null)
    );
}

// map value from string into its explicit type (number, boolean)
// TODO; maybe we can use it for more specific types, such as "address"..
export function explicitType([key, val]: [string, any]): any {
    const type = ConfigParamsTypes[key] as string;
    if (type === undefined) {
        error(`unexpected param ${key}=${val as string}`);
    }
    switch (type) {
        case 'boolean':
            if (val === 'true' || val === true) return [key, true];
            if (val === 'false' || val === false) return [key, false];
            break;
        case 'number': {
            const v = parseInt(val);
            if (!isNaN(v)) {
                return [key, v];
            }
            break;
        }
        default:
            return [key, val];
    }
    error(`Invalid ${type}: ${key} = ${val as string}`);
}

/**
 * initialize each parameter from commandline, env or config file (in that order)
 * config file must be provided either as command-line or env (obviously, not in
 * the config file..)
 */
export function parseServerConfig(args: string[], env: any): any {
    const envDefaults = filterMembers(env, ConfigParamsTypes);

    const argv = parseArgs(args, {
        string: filterType(ConfigParamsTypes, 'string'),
        // boolean: filterType(ConfigParamsTypes, 'boolean'),
        default: envDefaults
    });
    if (argv._.length > 0) {
        error(`unexpected param(s) ${argv._.join(',')}`);
    }
    // @ts-ignore
    delete argv._;
    let configFile: Partial<ServerConfigParams> = {};
    const configFileName = argv.config as string;
    if (configFileName != null) {
        if (!fs.existsSync(configFileName)) {
            error(`unable to read config file "${configFileName}"`);
        }
        configFile = JSON.parse(fs.readFileSync(configFileName, 'utf8'));
    }

    const config = {
        ...configFile,
        ...argv
    };
    return entriesToObj(Object.entries(config).map(explicitType));
}

// resolve params, and validate the resulting struct
export async function resolveServerConfig(
    config: Partial<ServerConfigParams>,
    web3provider: any
): Promise<ServerConfigParams> {
    const contractInteractor = new ContractInteractor(
        web3provider,
        configure({ relayHubAddress: config.relayHubAddress })
    );
    if (config.versionRegistryAddress != null) {
        if (config.relayHubAddress != null) {
            error(
                'missing param: must have either relayHubAddress or versionRegistryAddress'
            );
        }
        const relayHubId =
            config.relayHubId ??
            error('missing param: relayHubId to read from VersionRegistry');
        contractInteractor.validateAddress(
            config.versionRegistryAddress,
            'Invalid param versionRegistryAddress: '
        );
        if (
            !(await contractInteractor.isContractDeployed(
                config.versionRegistryAddress
            ))
        ) {
            error(
                'Invalid param versionRegistryAddress: no contract at address ' +
                    config.versionRegistryAddress
            );
        }

        const versionRegistry = new VersionRegistry(
            web3provider,
            config.versionRegistryAddress
        );
        const { version, value, time } = await versionRegistry.getVersion(
            relayHubId,
            config.versionRegistryDelayPeriod ?? DefaultRegistryDelayPeriod
        );
        contractInteractor.validateAddress(
            value,
            `Invalid param relayHubId ${relayHubId} @ ${version}: not an address:`
        );

        log.info(
            `Using RelayHub ID:${relayHubId} version:${version} address:${value} . created at: ${new Date(
                time * 1000
            ).toString()}`
        );
        config.relayHubAddress = value;
    } else {
        if (config.relayHubAddress == null) {
            error(
                'missing param: must have either relayHubAddress or versionRegistryAddress'
            );
        }
        contractInteractor.validateAddress(
            config.relayHubAddress,
            'invalid param: "relayHubAddress" is not a valid address:'
        );
    }

    if (
        !(await contractInteractor.isContractDeployed(config.relayHubAddress))
    ) {
        error(`RelayHub: no contract at address ${config.relayHubAddress}`);
    }

    if (config.collectorAddress) {
        const isCollectorDeployed = await contractInteractor.isContractDeployed(
            config.collectorAddress
        );
        if (!isCollectorDeployed) {
            error(
                `Collector: no contract at address ${config.relayHubAddress}`
            );
        }
    }

    if (config.url == null) error('missing param: url');
    if (config.workdir == null) error('missing param: workdir');
    return { ...serverDefaultConfiguration, ...config };
}

//FIXME: the incomming and outgoing type may and likely should differ. For example for all big number values the incoming value should be a string to prevent loss of precision, but outgoing type should be big number so that it doesn't need to be converted everywhere it is used.
export function configureServer(
    partialConfig: Partial<ServerConfigParams>
): ServerConfigParams {
    return {
        ...serverDefaultConfiguration,
        ...partialConfig
    };
}
