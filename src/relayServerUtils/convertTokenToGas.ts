import { BigNumber as BigNumberJs } from 'bignumber.js';
import { constants } from 'ethers';
import { getProvider } from '../Utils';
import { ERC20__factory } from '@rsksmart/rif-relay-contracts';
import type ExchangeToken from '../definitions/token.type';
import { BigNumberishJs, getXRateFor, toNativeWeiFrom } from '../Conversions';
import { callERC20Symbol } from './callERC20Symbol';
import { callERC20Decimals } from './callERC20Decimals';

export default async function convertTokenToGas(
  tokenAmount: BigNumberishJs,
  tokenContract: string,
  gasPrice: BigNumberishJs
) {
  let tokenAmountInNative = BigNumberJs(tokenAmount.toString());
  if (tokenContract !== constants.AddressZero) {
    const provider = getProvider();
    const tokenInstance = ERC20__factory.connect(tokenContract, provider);
    const symbol = await callERC20Symbol(tokenInstance, 'ERC20');
    const decimals = await callERC20Decimals(tokenInstance, 18);
    const token: ExchangeToken = {
      instance: tokenInstance,
      name: await tokenInstance.name(),
      symbol,
      decimals,
    };

    const xRate = await getXRateFor(token);

    tokenAmountInNative = toNativeWeiFrom({
      ...token,
      amount: tokenAmount.toString(),
      xRate,
    });
  }

  return tokenAmountInNative.dividedBy(gasPrice.toString());
}
