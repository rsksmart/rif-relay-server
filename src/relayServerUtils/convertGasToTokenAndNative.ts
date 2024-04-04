import { constants, BigNumber } from 'ethers';
import { getProvider } from '../Utils';
import { ERC20__factory } from '@rsksmart/rif-relay-contracts';
import type ExchangeToken from '../definitions/token.type';
import {
  convertGasToNative,
  convertGasToToken,
  getXRateFor,
} from '../Conversions';
import type { EnvelopingRequest } from '../definitions/HttpEnvelopingRequest';
import { callERC20Symbol } from './callERC20Symbol';
import { callERC20Decimals } from './callERC20Decimals';

export async function convertGasToTokenAndNative(
  relayRequest: EnvelopingRequest,
  initialEstimation: BigNumber
) {
  const gasPrice = relayRequest.relayData.gasPrice;
  const tokenContractAddress = relayRequest.request.tokenContract;

  let xRate = '1';
  let initialEstimationInNative: BigNumber = initialEstimation.mul(gasPrice);
  let initialEstimationInToken: BigNumber = initialEstimationInNative;
  if (tokenContractAddress !== constants.AddressZero) {
    const provider = getProvider();

    const tokenInstance = ERC20__factory.connect(
      tokenContractAddress,
      provider
    );

    const token: ExchangeToken = {
      instance: tokenInstance,
      name: await tokenInstance.name(),
      symbol: await callERC20Symbol(tokenInstance),
      decimals: await callERC20Decimals(tokenInstance),
    };

    xRate = await getXRateFor(token);

    initialEstimationInToken = convertGasToToken(
      initialEstimation,
      { ...token, xRate },
      gasPrice
    );

    initialEstimationInNative = convertGasToNative(initialEstimation, gasPrice);
  }

  return {
    value: initialEstimation.toString(),
    valueInToken: initialEstimationInToken.toString(),
    valueInNative: initialEstimationInNative.toString(),
    exchangeRate: xRate,
    gasPrice: gasPrice.toString(),
  };
}

export default convertGasToTokenAndNative;
