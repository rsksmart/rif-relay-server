import { JsonRpcProvider } from '@ethersproject/providers';
import { HttpClient } from '@rsksmart/rif-relay-client';
import { RelayHub__factory } from '@rsksmart/rif-relay-contracts';
import config from 'config';
import { BigNumber, constants, Signer, utils, Wallet } from 'ethers';
import log from 'loglevel';
import { getServerConfig, RegisterConfig } from '../ServerConfigParams';
import { isSameAddress, sleep } from '../Utils';
import { findWealthyAccount } from './findWealthyAccount';

//TODO: This is almost the same type as RegisterConfig from /ServerConfigParams
type RegisterOptions = {
  relayHub: string;
  relayUrl: string;
  signer: Signer;
  gasPrice: BigNumber;
  stake: BigNumber;
  funds: BigNumber;
  unstakeDelay: BigNumber;
};

const waitForRelay = async (
  httpClient: HttpClient,
  relayUrl: string,
  timeout = 60
): Promise<void> => {
  log.error(`Will wait up to ${timeout}s for the relay to be ready`);

  const endTime = Date.now() + timeout * 1000;
  while (Date.now() < endTime) {
    let isReady = false;
    try {
      isReady = (await httpClient.getChainInfo(relayUrl))?.ready;
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
};

const register = async (
  provider: JsonRpcProvider,
  options: RegisterOptions
): Promise<void> => {
  const transactions: string[] = [];
  log.info(`Registering Enveloping relayer at ${options.relayUrl}`);
  log.info('Options received:', options);

  const httpClient = new HttpClient();
  const response = await httpClient.getChainInfo(options.relayUrl);
  if (response.ready) {
    throw new Error('Already registered');
  }

  const { chainId } = await provider.getNetwork();

  if (response.chainId !== chainId.toString()) {
    throw new Error(
      `wrong chain-id: Relayer on (${
        response.chainId ?? -1
      }) but our provider is on (${chainId})`
    );
  }

  const relayHub = RelayHub__factory.connect(options.relayHub, provider);

  const relayAddress = response.relayManagerAddress;
  const { stake, unstakeDelay, owner } = await relayHub.getStakeInfo(
    relayAddress
  );

  log.info('Current stake info:');
  log.info('Relayer owner: ', owner);
  log.info('Current unstake delay: ', unstakeDelay.toString());
  log.info('current stake=', utils.formatUnits(stake.toString(), 'ether'));

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

  const bal = await provider.getBalance(relayAddress);

  if (bal.gt(options.funds)) {
    log.info('Relayer already funded');
  } else {
    log.info(
      `Funding relayer ${utils.formatUnits(options.funds, 'ether')} RBTC`
    );

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

  await waitForRelay(httpClient, options.relayUrl);
  log.info('Executed Transactions', transactions);
};

const retrieveSigner = async (
  rpcProvider: JsonRpcProvider,
  privateKey?: string,
  mnemonic?: string
) => {
  const walletFromPK = privateKey && new Wallet(privateKey, rpcProvider);
  const walletFromMnemonic =
    mnemonic && Wallet.fromMnemonic(mnemonic).connect(rpcProvider);

  return (
    walletFromPK ||
    walletFromMnemonic ||
    (await findWealthyAccount(rpcProvider))
  );
};

const executeRegister = async (): Promise<void> => {
  const {
    contracts,
    blockchain,
    register: {
      stake,
      funds,
      mnemonic,
      privateKey,
      gasPrice,
      relayHub,
      unstakeDelay,
    },
    app: { logLevel, url: serverUrl },
  } = getServerConfig();

  log.setLevel(logLevel);
  log.debug('configSources', config.util.getConfigSources());

  const rpcProvider = new JsonRpcProvider(blockchain.rskNodeUrl);

  await register(rpcProvider, {
    relayHub: relayHub || contracts.relayHubAddress,
    relayUrl: serverUrl,
    signer: await retrieveSigner(rpcProvider, privateKey, mnemonic),
    stake: utils.parseEther(stake.toString()),
    funds: utils.parseEther(funds.toString()),
    unstakeDelay: BigNumber.from(unstakeDelay),
    gasPrice: BigNumber.from(gasPrice),
  });
};

executeRegister()
  .then(() => {
    log.info('Registration is done!');
  })
  .catch((error) => {
    // we don't use the log library here because an error could be raised before setting the log level.
    console.error('Error registering relay server', error);
  });

export type { RegisterOptions, RegisterConfig };
