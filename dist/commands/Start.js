"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// TODO: convert to 'commander' format
const fs_1 = __importDefault(require("fs"));
const web3_1 = __importDefault(require("web3"));
const HttpServer_1 = require("../HttpServer");
const RelayServer_1 = require("../RelayServer");
const KeyManager_1 = require("../KeyManager");
const TxStoreManager_1 = require("../TxStoreManager");
const rif_relay_common_1 = require("@rsksmart/rif-relay-common");
const rif_relay_client_1 = require("@rsksmart/rif-relay-client");
const ServerConfigParams_1 = require("../ServerConfigParams");
const loglevel_1 = __importDefault(require("loglevel"));
function error(err) {
    loglevel_1.default.error(err);
    process.exit(1);
}
async function run() {
    let config;
    let web3provider;
    let trustedVerifiers = [];
    loglevel_1.default.info('Starting Enveloping Relay Server process...\n');
    try {
        const conf = await ServerConfigParams_1.parseServerConfig(process.argv.slice(2), process.env);
        loglevel_1.default.setLevel(conf.logLevel);
        loglevel_1.default.info(conf);
        if (conf.rskNodeUrl == null) {
            error('missing rskNodeUrl');
        }
        if (conf.trustedVerifiers !== undefined &&
            conf.trustedVerifiers != null &&
            conf.trustedVerifiers !== '') {
            trustedVerifiers = JSON.parse(conf.trustedVerifiers);
        }
        web3provider = new web3_1.default.providers.HttpProvider(conf.rskNodeUrl);
        loglevel_1.default.debug('runServer() - web3Provider done');
        config = (await ServerConfigParams_1.resolveServerConfig(conf, web3provider));
        loglevel_1.default.debug('runServer() - config done');
        if (trustedVerifiers.length > 0) {
            config.trustedVerifiers = trustedVerifiers;
        }
    }
    catch (e) {
        if (e instanceof Error) {
            error(e.message);
        }
        else {
            loglevel_1.default.error(e);
        }
    }
    const { devMode, workdir } = config;
    if (devMode) {
        if (fs_1.default.existsSync(`${workdir}/${TxStoreManager_1.TXSTORE_FILENAME}`)) {
            fs_1.default.unlinkSync(`${workdir}/${TxStoreManager_1.TXSTORE_FILENAME}`);
        }
    }
    const managerKeyManager = new KeyManager_1.KeyManager(1, workdir + '/manager');
    const workersKeyManager = new KeyManager_1.KeyManager(1, workdir + '/workers');
    loglevel_1.default.debug('runServer() - manager and workers configured');
    const txStoreManager = new TxStoreManager_1.TxStoreManager({ workdir });
    const contractInteractor = new rif_relay_common_1.ContractInteractor(web3provider, rif_relay_client_1.configure({
        relayHubAddress: config.relayHubAddress,
        deployVerifierAddress: config.deployVerifierAddress,
        relayVerifierAddress: config.relayVerifierAddress
    }));
    await contractInteractor.init();
    loglevel_1.default.debug('runServer() - contract interactor initilized');
    const dependencies = {
        txStoreManager,
        managerKeyManager,
        workersKeyManager,
        contractInteractor
    };
    const relayServer = new RelayServer_1.RelayServer(config, dependencies);
    await relayServer.init();
    loglevel_1.default.debug('runServer() - Relay Server initialized');
    const httpServer = new HttpServer_1.HttpServer(config.port, relayServer);
    httpServer.start();
    loglevel_1.default.debug('runServer() - Relay Server started');
}
run()
    .then(() => {
    loglevel_1.default.debug('runServer() - Relay Server running');
})
    .catch((error) => {
    loglevel_1.default.error('runServer() - Error running server', error);
});
//# sourceMappingURL=Start.js.map