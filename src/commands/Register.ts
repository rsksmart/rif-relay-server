import { CommandClient } from './helpers/CommandClient';
import {
    constants,
    EnvelopingConfig,
    isSameAddress
} from '@rsksmart/rif-relay-common';
import BN from 'bn.js';
import { fromWei, toBN } from 'web3-utils';
import { TransactionReceipt } from 'web3-core';
import { getParams, parseServerConfig } from './helpers/Utils';
import { configure } from '@rsksmart/rif-relay-client';
// @ts-ignore
import { ether } from '@openzeppelin/test-helpers';
import { ServerConfigParams } from '../ServerConfigParams';
import log from 'loglevel';

export interface RegisterOptions {
    hub: string;
    from: string;
    gasPrice: string | BN;
    stake: string | BN;
    funds: string | BN;
    relayUrl: string;
    unstakeDelay: string;
}

export class Register extends CommandClient {
    constructor(host: string, config: EnvelopingConfig, mnemonic?: string) {
        super(host, config, mnemonic);
    }

    async execute(options: RegisterOptions): Promise<void> {
        const transactions: string[] = [];
        log.info(`Registering Enveloping relayer at ${options.relayUrl}`);
        log.info('Options received:', options);
        const response = await this.httpClient.getPingResponse(
            options.relayUrl
        );
        if (response.ready) {
            throw new Error('Already registered');
        }

        if (!this.contractInteractor.isInitialized()) {
            await this.contractInteractor.init();
        }

        const chainId = this.contractInteractor.chainId;

        if (response.chainId !== chainId.toString()) {
            throw new Error(
                `wrong chain-id: Relayer on (${response.chainId}) but our provider is on (${chainId})`
            );
        }

        const relayAddress = response.relayManagerAddress;
        const relayHubAddress =
            this.config.relayHubAddress ?? response.relayHubAddress;
        const relayHub = await this.contractInteractor._createRelayHub(
            relayHubAddress
        );
        const { stake, unstakeDelay, owner } = await relayHub.getStakeInfo(
            relayAddress
        );

        log.info('Current stake info:');
        log.info('Relayer owner: ', owner);
        log.info('Current unstake delay: ', unstakeDelay);
        log.info('current stake=', fromWei(stake, 'ether'));

        if (
            owner !== constants.ZERO_ADDRESS &&
            !isSameAddress(owner, options.from)
        ) {
            throw new Error(
                `Already owned by ${owner}, our account=${options.from}`
            );
        }

        if (
            toBN(unstakeDelay).gte(toBN(options.unstakeDelay)) &&
            toBN(stake).gte(toBN(options.stake.toString()))
        ) {
            log.info('Relayer already staked');
        } else {
            const stakeValue = toBN(options.stake.toString()).sub(toBN(stake));
            log.info(
                `Staking relayer ${fromWei(stakeValue, 'ether')} RBTC`,
                stake === '0'
                    ? ''
                    : ` (already has ${fromWei(stake, 'ether')} RBTC)`
            );

            const stakeTx = await relayHub.stakeForAddress(
                relayAddress,
                options.unstakeDelay.toString(),
                {
                    value: stakeValue,
                    from: options.from,
                    gas: 1e6,
                    gasPrice: options.gasPrice
                }
            );
            transactions.push(stakeTx.tx);
        }

        if (isSameAddress(owner, options.from)) {
            log.info('Relayer already authorized');
        }

        const bal = await this.contractInteractor.getBalance(relayAddress);

        if (toBN(bal).gt(toBN(options.funds.toString()))) {
            log.info('Relayer already funded');
        } else {
            log.info('Funding relayer');

            const _fundTx = await this.web3.eth.sendTransaction({
                from: options.from,
                to: relayAddress,
                value: options.funds,
                gas: 1e6,
                gasPrice: options.gasPrice
            });
            const fundTx = _fundTx as TransactionReceipt;
            if (fundTx.transactionHash == null) {
                throw new Error(
                    `Fund transaction reverted: ${JSON.stringify(_fundTx)}`
                );
            }
            transactions.push(fundTx.transactionHash);
        }

        await this.waitForRelay(options.relayUrl);
        log.info('Executed Transactions', transactions);
    }
}

export async function executeRegister(registerOptions?: RegisterOptions) {
    const parameters: any = getParams();
    log.info('Parsed parameters', parameters);
    const serverConfiguration: ServerConfigParams = parseServerConfig(
        parameters.config
    );
    const register = new Register(
        serverConfiguration.rskNodeUrl,
        configure({ relayHubAddress: serverConfiguration.relayHubAddress }),
        parameters.mnemonic
    );
    const portIncluded: boolean = serverConfiguration.url.indexOf(':') > 0;
    const relayUrl =
        serverConfiguration.url +
        (!portIncluded && serverConfiguration.port > 0
            ? ':' + serverConfiguration.port.toString()
            : '');
    await register.execute(
        registerOptions
            ? registerOptions
            : {
                  hub: serverConfiguration.relayHubAddress,
                  from:
                      parameters.account ??
                      (await register.findWealthyAccount()),
                  stake: ether(
                      parameters.stake ? parameters.stake.toString() : '0.01'
                  ),
                  funds: ether(
                      parameters.funds ? parameters.funds.toString() : '0.02'
                  ),
                  relayUrl,
                  unstakeDelay: '1000',
                  gasPrice: '60000000'
              }
    );
}

executeRegister()
    .then(() => {
        log.info('Registration is done!');
    })
    .catch((error) => {
        log.info('Error registering relay server', error);
    });
