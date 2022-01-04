"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureServer = exports.resolveServerConfig = exports.parseServerConfig = exports.explicitType = exports.filterMembers = exports.entriesToObj = exports.filterType = void 0;
const minimist_1 = __importDefault(require("minimist"));
const fs = __importStar(require("fs"));
const rif_relay_common_1 = require("@rsksmart/rif-relay-common");
const rif_relay_client_1 = require("@rsksmart/rif-relay-client");
//@ts-ignore
const source_map_support_1 = __importDefault(require("source-map-support"));
//@ts-ignore
source_map_support_1.default.install({ errorFormatterForce: true });
const serverDefaultConfiguration = {
    alertedBlockDelay: 0,
    minAlertedDelayMS: 0,
    maxAlertedDelayMS: 0,
    relayHubAddress: rif_relay_common_1.constants.ZERO_ADDRESS,
    relayVerifierAddress: rif_relay_common_1.constants.ZERO_ADDRESS,
    deployVerifierAddress: rif_relay_common_1.constants.ZERO_ADDRESS,
    trustedVerifiers: [],
    gasPriceFactor: 1,
    registrationBlockRate: 0,
    workerMinBalance: 0.001e18,
    workerTargetBalance: 0.003e18,
    managerMinBalance: 0.001e18,
    managerMinStake: '1',
    managerTargetBalance: 0.003e18,
    minHubWithdrawalBalance: 0.001e18,
    checkInterval: 10000,
    readyTimeout: 30000,
    devMode: false,
    customReplenish: false,
    logLevel: 1,
    url: 'http://localhost:8090',
    rskNodeUrl: '',
    port: 0,
    versionRegistryAddress: rif_relay_common_1.constants.ZERO_ADDRESS,
    workdir: '',
    refreshStateTimeoutBlocks: 5,
    pendingTransactionTimeoutBlocks: 30,
    successfulRoundsForReady: 3,
    confirmationsNeeded: 12,
    retryGasPriceFactor: 1.2,
    defaultGasLimit: 500000,
    maxGasPrice: (100e9).toString(),
    estimateGasFactor: 1.2,
    allowForSponsoredTx: true
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
    allowForSponsoredTx: 'boolean'
};
// by default: no waiting period - use VersionRegistry entries immediately.
const DefaultRegistryDelayPeriod = 0;
// helper function: throw and never return..
function error(err) {
    throw new Error(err);
}
// get the keys matching specific type from ConfigParamsType
function filterType(config, type) {
    return Object.entries(config).flatMap((e) => (e[1] === type ? [e[0]] : []));
}
exports.filterType = filterType;
// convert [key,val] array (created by Object.entries) back to an object.
function entriesToObj(entries) {
    return entries.reduce((set, [k, v]) => (Object.assign(Object.assign({}, set), { [k]: v })), {});
}
exports.entriesToObj = entriesToObj;
// filter and return from env only members that appear in "config"
function filterMembers(env, config) {
    return entriesToObj(Object.entries(env).filter((e) => config[e[0]] != null));
}
exports.filterMembers = filterMembers;
// map value from string into its explicit type (number, boolean)
// TODO; maybe we can use it for more specific types, such as "address"..
function explicitType([key, val]) {
    const type = ConfigParamsTypes[key];
    if (type === undefined) {
        error(`unexpected param ${key}=${val}`);
    }
    switch (type) {
        case 'boolean':
            if (val === 'true' || val === true)
                return [key, true];
            if (val === 'false' || val === false)
                return [key, false];
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
    error(`Invalid ${type}: ${key} = ${val}`);
}
exports.explicitType = explicitType;
/**
 * initialize each parameter from commandline, env or config file (in that order)
 * config file must be provided either as command-line or env (obviously, not in
 * the config file..)
 */
function parseServerConfig(args, env) {
    const envDefaults = filterMembers(env, ConfigParamsTypes);
    const argv = minimist_1.default(args, {
        string: filterType(ConfigParamsTypes, 'string'),
        // boolean: filterType(ConfigParamsTypes, 'boolean'),
        default: envDefaults
    });
    if (argv._.length > 0) {
        error(`unexpected param(s) ${argv._.join(',')}`);
    }
    // @ts-ignore
    delete argv._;
    let configFile = {};
    const configFileName = argv.config;
    if (configFileName != null) {
        if (!fs.existsSync(configFileName)) {
            error(`unable to read config file "${configFileName}"`);
        }
        configFile = JSON.parse(fs.readFileSync(configFileName, 'utf8'));
    }
    const config = Object.assign(Object.assign({}, configFile), argv);
    return entriesToObj(Object.entries(config).map(explicitType));
}
exports.parseServerConfig = parseServerConfig;
// resolve params, and validate the resulting struct
async function resolveServerConfig(config, web3provider) {
    var _a, _b;
    const contractInteractor = new rif_relay_common_1.ContractInteractor(web3provider, rif_relay_client_1.configure({ relayHubAddress: config.relayHubAddress }));
    if (config.versionRegistryAddress != null) {
        if (config.relayHubAddress != null) {
            error('missing param: must have either relayHubAddress or versionRegistryAddress');
        }
        const relayHubId = (_a = config.relayHubId) !== null && _a !== void 0 ? _a : error('missing param: relayHubId to read from VersionRegistry');
        contractInteractor.validateAddress(config.versionRegistryAddress, 'Invalid param versionRegistryAddress: ');
        if (!(await contractInteractor.isContractDeployed(config.versionRegistryAddress))) {
            error('Invalid param versionRegistryAddress: no contract at address ' +
                config.versionRegistryAddress);
        }
        const versionRegistry = new rif_relay_common_1.VersionRegistry(web3provider, config.versionRegistryAddress);
        const { version, value, time } = await versionRegistry.getVersion(relayHubId, (_b = config.versionRegistryDelayPeriod) !== null && _b !== void 0 ? _b : DefaultRegistryDelayPeriod);
        contractInteractor.validateAddress(value, `Invalid param relayHubId ${relayHubId} @ ${version}: not an address:`);
        console.log(`Using RelayHub ID:${relayHubId} version:${version} address:${value} . created at: ${new Date(time * 1000).toString()}`);
        config.relayHubAddress = value;
    }
    else {
        if (config.relayHubAddress == null) {
            error('missing param: must have either relayHubAddress or versionRegistryAddress');
        }
        contractInteractor.validateAddress(config.relayHubAddress, 'invalid param: "relayHubAddress" is not a valid address:');
    }
    if (!(await contractInteractor.isContractDeployed(config.relayHubAddress))) {
        error(`RelayHub: no contract at address ${config.relayHubAddress}`);
    }
    if (config.url == null)
        error('missing param: url');
    if (config.workdir == null)
        error('missing param: workdir');
    return Object.assign(Object.assign({}, serverDefaultConfiguration), config);
}
exports.resolveServerConfig = resolveServerConfig;
function configureServer(partialConfig) {
    return Object.assign({}, serverDefaultConfiguration, partialConfig);
}
exports.configureServer = configureServer;
//# sourceMappingURL=ServerConfigParams.js.map