import BN from 'bn.js';
import HDWalletProvider from '@truffle/hdwallet-provider';
import Web3 from 'web3';
import { HttpProvider } from 'web3-core';
import {
    ContractInteractor,
    EnvelopingConfig,
    sleep
} from '@rsksmart/rif-relay-common';
import { HttpClient, HttpWrapper } from '@rsksmart/rif-relay-client';
// @ts-ignore
import { ether } from '@openzeppelin/test-helpers';
import log from 'loglevel';

/**
 * This is helper class to execute commands to interact with the server
 */
export abstract class CommandClient {
    protected readonly contractInteractor: ContractInteractor;
    protected readonly httpClient: HttpClient;
    protected readonly config: EnvelopingConfig;
    protected readonly web3: Web3;

    constructor(host: string, config: EnvelopingConfig, mnemonic?: string) {
        let provider: HttpProvider | HDWalletProvider =
            new Web3.providers.HttpProvider(host);
        if (mnemonic != null) {
            provider = new HDWalletProvider(
                mnemonic as any,
                provider as any
            ) as unknown as HttpProvider;
        }
        this.httpClient = new HttpClient(new HttpWrapper(), config);
        this.contractInteractor = new ContractInteractor(provider, config);
        this.config = config;
        this.web3 = new Web3(provider);
    }

    async findWealthyAccount(requiredBalance = ether('2')): Promise<string> {
        let accounts: string[] = [];
        try {
            accounts = await this.web3.eth.getAccounts();
            for (const account of accounts) {
                const balance = new BN(await this.web3.eth.getBalance(account));
                if (balance.gte(requiredBalance)) {
                    log.info(`Found funded account ${account}`);
                    return account;
                }
            }
        } catch (error) {
            log.error('Failed to retrieve accounts and balances:', error);
        }
        throw new Error(
            `could not find unlocked account with sufficient balance; all accounts:\n - ${accounts.join(
                '\n - '
            )}`
        );
    }

    async isRelayReady(relayUrl: string): Promise<boolean> {
        const response = await this.httpClient.getPingResponse(relayUrl);
        return response.ready;
    }

    async waitForRelay(relayUrl: string, timeout = 60): Promise<void> {
        log.error(`Will wait up to ${timeout}s for the relay to be ready`);

        const endTime = Date.now() + timeout * 1000;
        while (Date.now() < endTime) {
            let isReady = false;
            try {
                isReady = await this.isRelayReady(relayUrl);
            } catch (e) {
                if (e instanceof Error) {
                    log.info(e.message);
                } else {
                    log.error(e);
                }
            }
            if (isReady) {
                return;
            }
            await sleep(3000);
        }
        throw Error(`Relay not ready after ${timeout}s`);
    }

    abstract execute(args: any): Promise<void>;
}
