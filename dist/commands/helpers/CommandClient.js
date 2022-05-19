"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandClient = void 0;
const bn_js_1 = __importDefault(require("bn.js"));
const hdwallet_provider_1 = __importDefault(require("@truffle/hdwallet-provider"));
const web3_1 = __importDefault(require("web3"));
const rif_relay_common_1 = require("@rsksmart/rif-relay-common");
const rif_relay_client_1 = require("@rsksmart/rif-relay-client");
// @ts-ignore
const test_helpers_1 = require("@openzeppelin/test-helpers");
const loglevel_1 = __importDefault(require("loglevel"));
/**
 * This is helper class to execute commands to interact with the server
 */
class CommandClient {
    constructor(host, config, mnemonic) {
        let provider = new web3_1.default.providers.HttpProvider(host);
        if (mnemonic != null) {
            provider = new hdwallet_provider_1.default(mnemonic, provider);
        }
        this.httpClient = new rif_relay_client_1.HttpClient(new rif_relay_client_1.HttpWrapper(), config);
        this.contractInteractor = new rif_relay_common_1.ContractInteractor(provider, config);
        this.config = config;
        this.web3 = new web3_1.default(provider);
    }
    async findWealthyAccount(requiredBalance = test_helpers_1.ether('2')) {
        let accounts = [];
        try {
            accounts = await this.web3.eth.getAccounts();
            for (const account of accounts) {
                const balance = new bn_js_1.default(await this.web3.eth.getBalance(account));
                if (balance.gte(requiredBalance)) {
                    loglevel_1.default.info(`Found funded account ${account}`);
                    return account;
                }
            }
        }
        catch (error) {
            loglevel_1.default.error('Failed to retrieve accounts and balances:', error);
        }
        throw new Error(`could not find unlocked account with sufficient balance; all accounts:\n - ${accounts.join('\n - ')}`);
    }
    async isRelayReady(relayUrl) {
        const response = await this.httpClient.getPingResponse(relayUrl);
        return response.ready;
    }
    async waitForRelay(relayUrl, timeout = 60) {
        loglevel_1.default.error(`Will wait up to ${timeout}s for the relay to be ready`);
        const endTime = Date.now() + timeout * 1000;
        while (Date.now() < endTime) {
            let isReady = false;
            try {
                isReady = await this.isRelayReady(relayUrl);
            }
            catch (e) {
                if (e instanceof Error) {
                    loglevel_1.default.info(e.message);
                }
                else {
                    loglevel_1.default.error(e);
                }
            }
            if (isReady) {
                return;
            }
            await rif_relay_common_1.sleep(3000);
        }
        throw Error(`Relay not ready after ${timeout}s`);
    }
}
exports.CommandClient = CommandClient;
//# sourceMappingURL=CommandClient.js.map