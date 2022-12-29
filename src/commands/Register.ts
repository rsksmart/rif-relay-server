import log from 'loglevel';
import { BigNumber, utils, constants, Signer } from 'ethers';
import type { Provider } from '@ethersproject/providers';
import config from 'config';

import { getServerConfig } from '../ServerConfigParams';

import { CommandClient } from './helpers/CommandClient';
import { isSameAddress } from '../Utils';
import { RelayHub__factory } from '@rsksmart/rif-relay-contracts';

export type RegisterOptions = {
  hub: string;
  signer: Signer;
  gasPrice: string | BigNumber;
  stake: string | BigNumber;
  funds: string | BigNumber;
  relayUrl: string;
  unstakeDelay: string;
};

type RegisterConfig = {
  account: string | undefined;
  stake: string | undefined;
  funds: string | undefined;
  mnemonic: string | undefined;
};

export class Register extends CommandClient {
  constructor(host: string, mnemonic?: string) {
    super(host, mnemonic);
  }

  async execute(options: RegisterOptions): Promise<void> {
    const transactions: string[] = [];
    log.info(`Registering Enveloping relayer at ${options.relayUrl}`);
    log.info('Options received:', options);
    const response = await this._httpClient.getChainInfo(options.relayUrl);
    if (response.ready) {
      throw new Error('Already registered');
    }

    const { chainId } = await (this._provider as Provider).getNetwork();

    if (response.chainId !== chainId.toString()) {
      throw new Error(
        `wrong chain-id: Relayer on (${
          response.chainId ?? 0
        }) but our provider is on (${chainId})`
      );
    }

    const relayHub = RelayHub__factory.connect(options.hub, this._provider);

    const relayAddress = response.relayManagerAddress;
    const { stake, unstakeDelay, owner } = await relayHub.getStakeInfo(
      relayAddress
    );

    log.info('Current stake info:');
    log.info('Relayer owner: ', owner);
    log.info('Current unstake delay: ', unstakeDelay.toString());
    log.info('current stake=', utils.formatUnits(stake, 'ether'));

    const from = await options.signer.getAddress();
    if (owner !== constants.AddressZero && !isSameAddress(owner, from)) {
      throw new Error(`Already owned by ${owner}, our account=${from}`);
    }

    if (unstakeDelay.gte(options.unstakeDelay) && stake.gte(options.stake)) {
      log.info('Relayer already staked');
    } else {
      const stakeValue = options.stake.sub(stake);
      log.info(
        `Staking relayer ${utils.formatUnits(stakeValue, 'ether')} RBTC`,
        stake.eq(constants.Zero)
          ? ''
          : ` (already has ${utils.formatUnits(stake, 'ether')} RBTC)`
      );

      const stakeTx = await relayHub
        .connect(options.signer)
        .stakeForAddress(relayAddress, options.unstakeDelay.toString(), {
          value: stakeValue,
          gasLimit: 1e6,
          gasPrice: options.gasPrice,
        });

      transactions.push(stakeTx.hash);
    }

    if (isSameAddress(owner, from)) {
      log.info('Relayer already authorized');
    }

    const bal = await this._provider.getBalance(relayAddress);

    if (bal.gt(options.funds)) {
      log.info('Relayer already funded');
    } else {
      log.info('Funding relayer');

      const fundTx = await options.signer.sendTransaction({
        to: relayAddress,
        value: options.funds,
        gasLimit: 1e6,
        gasPrice: options.gasPrice,
      });

      if (fundTx.hash == null) {
        throw new Error(`Fund transaction reverted: ${JSON.stringify(fundTx)}`);
      }
      transactions.push(fundTx.hash);
    }

    await this.waitForRelay(options.relayUrl);
    log.info('Executed Transactions', transactions);
  }
}

export async function executeRegister(registerOptions?: RegisterOptions) {
  const { app, contracts, blockchain } = getServerConfig();
  let registerConfig: RegisterConfig | undefined = undefined;
  if (config.has('register')) {
    registerConfig = config.get('register');
  }
  log.setLevel(app.logLevel);
  const register = new Register(
    blockchain.rskNodeUrl,
    registerConfig?.mnemonic
  );
  const portIncluded: boolean = app.url.indexOf(':') > 0;
  const relayUrl =
    app.url + (!portIncluded && app.port > 0 ? ':' + app.port.toString() : '');
  await register.execute(
    registerOptions
      ? registerOptions
      : {
          hub: contracts.relayHubAddress,
          signer: await register.findWealthyAccount(),
          stake: utils.parseEther(registerConfig?.stake ?? '0.01'),
          funds: utils.parseEther(registerConfig?.funds ?? '0.02'),
          relayUrl,
          unstakeDelay: '1000',
          gasPrice: '60000000',
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
