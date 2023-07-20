import { expect, use } from 'chai';
import { utils, type providers } from 'ethers';
import {
  REGTEST_CHAIN_ID,
  findWealthyAccount,
} from 'src/commands/findWealthyAccount';
import chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);

const TESTNET_CHAIN_ID = 31;
const MAINNET_CHAIN_ID = 30;

describe('findWealthAccounts', function () {
  const expectedSigner = {
    getAddress: () => '0x123abc',
    getBalance: () => Promise.resolve(utils.parseUnits('2', 'ether')),
  };

  const getMockedProvider = (expectedChainId: number) =>
    ({
      getNetwork: () => ({ chainId: expectedChainId }),
      listAccounts: () => [1, 2, 3],
      getSigner: () => expectedSigner,
    } as unknown as providers.JsonRpcProvider);

  const expectFindWealthyAccountToFail = async (chainId: number) => {
    const mockRpcProvider = getMockedProvider(chainId);
    await expect(findWealthyAccount(mockRpcProvider)).to.rejectedWith(
      'Unlocked accounts are allowed for testing purposes only'
    );
  };

  it('should not raise an error if it is used for dev purposes', async function () {
    const mockRpcProvider = getMockedProvider(REGTEST_CHAIN_ID);
    const account = await findWealthyAccount(mockRpcProvider);
    expect(account).to.be.eq(expectedSigner);
  });

  it('should raise an error if it is not used on Testnet', async function () {
    await expectFindWealthyAccountToFail(TESTNET_CHAIN_ID);
  });

  it('should raise an error if it is not used on Mainnet', async function () {
    await expectFindWealthyAccountToFail(MAINNET_CHAIN_ID);
  });

  it('should raise an error if no accounts are found with enough balance', async function () {
    const mockRpcProvider = getMockedProvider(REGTEST_CHAIN_ID);
    await expect(
      findWealthyAccount(mockRpcProvider, utils.parseUnits('3', 'ether'))
    ).to.rejectedWith(
      'could not find unlocked account with sufficient balance;'
    );
  });
});
