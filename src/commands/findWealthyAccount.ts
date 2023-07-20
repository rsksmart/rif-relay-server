import type { JsonRpcProvider } from '@ethersproject/providers';
import { BigNumber, Signer, utils } from 'ethers';
import log from 'loglevel';

export const REGTEST_CHAIN_ID = 33;

export const findWealthyAccount = async (
  rpcProvider: JsonRpcProvider,
  requiredBalance: BigNumber = utils.parseUnits('2', 'ether')
): Promise<Signer> => {
  const { chainId } = await rpcProvider.getNetwork();
  if (chainId !== REGTEST_CHAIN_ID) {
    throw new Error('Unlocked accounts are allowed for testing purposes only');
  }

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
