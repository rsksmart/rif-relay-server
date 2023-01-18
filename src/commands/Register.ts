import { JsonRpcProvider } from '@ethersproject/providers';
import { HttpClient } from '@rsksmart/rif-relay-client';
import { RelayHub__factory } from '@rsksmart/rif-relay-contracts';
import config from 'config';
import { BigNumber, constants, Signer, utils, Wallet } from 'ethers';
import log from 'loglevel';
import { getServerConfig } from '../ServerConfigParams';
import { isSameAddress, sleep } from '../Utils';

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
  account?: string;
  stake?: string;
  funds?: string;
  mnemonic?: string;
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

  await waitForRelay(httpClient, options.relayUrl);
  log.info('Executed Transactions', transactions);
};

export async function executeRegister() {
  // FIXME: add registerOptions?: RegisterOptions from either config or cli (which one?)
  const { app, contracts, blockchain } = getServerConfig();
  const { account, stake, funds, mnemonic }: RegisterConfig = config.has(
    'register'
  )
    ? config.get<RegisterConfig>('register')
    : {};

  console.log(
    `🐞 ᨟ ---------------------------------------------------------------------------------------------------------------------------🐞 ᨟`
  );
  console.log(
    `🐞 ᨟ :: file: register.ts:176 :: executeRegister :: { account, stake, funds, mnemonic }`,
    { account, stake, funds, mnemonic }
  );
  console.log(
    `🐞 ᨟ ---------------------------------------------------------------------------------------------------------------------------🐞 ᨟`
  );

  if (account && !mnemonic) {
    log.error(`
    You must configure mnemonic for given account address.
    `);
  }

  log.setLevel(app.logLevel);
  const rpcProvider = new JsonRpcProvider(blockchain.rskNodeUrl);
  const portIncluded: boolean = app.url.indexOf(':') > 0;
  const relayUrl =
    app.url + (!portIncluded && app.port > 0 ? ':' + app.port.toString() : '');

  const signer =
    account && mnemonic
      ? Wallet.fromMnemonic(mnemonic).connect(rpcProvider)
      : await findWealthyAccount(rpcProvider);

  const signerAddress = await signer.getAddress();
  if (signerAddress !== account) {
    // TODO: probably no point giving the option to configure account if we are going to derive it from the mnemonic. Also should we allow account retreival from private keys (new Wallet(privateKey, rpcProvider))?
    throw Error(
      `The account configured in the register section of the configuration file does not match the account derived from the mnemonic. 
        Account configured: ${account as string}
        Account derived: ${signerAddress}`
    );
  }

  await register(
    rpcProvider,
    // registerOptions ??
    {
      hub: contracts.relayHubAddress,
      signer,
      stake: utils.parseEther(stake ?? '0.01'),
      funds: utils.parseEther(funds ?? '0.02'),
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
