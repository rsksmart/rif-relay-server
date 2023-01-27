import { JsonRpcProvider } from '@ethersproject/providers';
import { HttpClient } from '@rsksmart/rif-relay-client';
import { RelayHub__factory } from '@rsksmart/rif-relay-contracts';
import config from 'config';
import { BigNumber, constants, Signer, utils, Wallet } from 'ethers';
import log from 'loglevel';
import { getServerConfig } from '../ServerConfigParams';
import { isSameAddress, sleep } from '../Utils';

type RegisterConfig = {
  stake: string;
  funds: string;
  mnemonic?: string;
  privateKey?: string;
  hub?: string;
  signer: Signer;
  gasPrice: number;
  relayUrl?: string;
  unstakeDelay: number;
};

type RegisterOptions = {
  hub: string;
  relayUrl: string;
  signer: Signer;
  gasPrice: BigNumber;
  stake: BigNumber;
  funds: BigNumber;
  unstakeDelay: BigNumber;
};

const findWealthyAccount = async (
  rpcProvider: JsonRpcProvider,
  requiredBalance: BigNumber = utils.parseUnits('2', 'ether')
): Promise<Signer> => {
  let accounts: string[] = [];
  try {
    accounts = await rpcProvider.listAccounts();
    for (let i = 0; i < accounts.length; i++) {
      const signer = rpcProvider.getSigner(i);
      const balance = await signer.getBalance();
      if (balance.gte(requiredBalance)) {
        log.info(`Found funded account ${await signer.getAddress()}`);

        return signer;
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
        response.chainId ?? 0
      }) but our provider is on (${chainId})`
    );
  }

  const relayHub = RelayHub__factory.connect(options.hub, provider);

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

const retreiveSigner = async (
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
  const { app, contracts, blockchain } = getServerConfig();
  log.setLevel(app.logLevel);
  log.debug('configSources', config.util.getConfigSources());
  if (!config.has('register')) {
    throw new Error(
      'No register config found. Make sure that the register section exists in default.json5.'
    );
  }

  const {
    stake,
    funds,
    mnemonic,
    privateKey,
    signer,
    gasPrice,
    hub,
    relayUrl,
    unstakeDelay,
  }: RegisterConfig = config.get('register');

  const rpcProvider = new JsonRpcProvider(blockchain.rskNodeUrl);
  const portFromUrl = app.url.match(/:(\d{0,5})$/);
  const serverUrl =
    !portFromUrl && app.port ? `${app.url}:${app.port}` : app.url;

  await register(rpcProvider, {
    hub: hub || contracts.relayHubAddress,
    relayUrl: relayUrl || serverUrl,
    signer: signer._isSigner
      ? signer
      : await retreiveSigner(rpcProvider, privateKey, mnemonic),
    stake: utils.parseEther(stake),
    funds: utils.parseEther(funds),
    unstakeDelay: BigNumber.from(unstakeDelay),
    gasPrice: BigNumber.from(gasPrice),
  });
};

executeRegister()
  .then(() => {
    log.info('Registration is done!');
  })
  .catch((error) => {
    log.info('Error registering relay server', error);
  });

export type { RegisterOptions, RegisterConfig };
