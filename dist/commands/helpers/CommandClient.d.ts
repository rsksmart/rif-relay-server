import Web3 from 'web3';
import { ContractInteractor, EnvelopingConfig } from '@rsksmart/rif-relay-common';
import { HttpClient } from '@rsksmart/rif-relay-client';
/**
 * This is helper class to execute commands to interact with the server
 */
export declare abstract class CommandClient {
    protected readonly contractInteractor: ContractInteractor;
    protected readonly httpClient: HttpClient;
    protected readonly config: EnvelopingConfig;
    protected readonly web3: Web3;
    constructor(host: string, config: EnvelopingConfig, mnemonic?: string);
    findWealthyAccount(requiredBalance?: any): Promise<string>;
    isRelayReady(relayUrl: string): Promise<boolean>;
    waitForRelay(relayUrl: string, timeout?: number): Promise<void>;
    abstract execute(args: any): Promise<void>;
}
