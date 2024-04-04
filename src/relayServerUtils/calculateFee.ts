import { getExchangeRate } from '@rsksmart/rif-relay-client';
import { ERC20__factory } from '@rsksmart/rif-relay-contracts';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import type { BigNumber } from 'ethers';
import { constants } from 'ethers';
import log from 'loglevel';
import type { BigNumberishJs } from '../Conversions';
import { toPrecision } from '../Conversions';
import type { EnvelopingRequest } from '../definitions/HttpEnvelopingRequest';
import type { AppConfig } from '../ServerConfigParams';
import { getProvider } from '../Utils';
import callERC20Decimals from './callERC20Decimals';
import callERC20Symbol from './callERC20Symbol';
import { US_DOLLAR_SYMBOL, VALUE_INDEX_IN_DATA } from './constants';
import convertTokenToGas from './convertTokenToGas';
import { getMethodHashFromData } from './getMethodHashFromData';
import { isSponsorshipAllowed } from './isSponsorshipAllowed';

export function isTransferOrTransferFrom(data: string) {
  const methodHash = getMethodHashFromData(data);

  return VALUE_INDEX_IN_DATA.has(methodHash);
}

export async function calculateFixedUsdFee(
  envelopingRequest: EnvelopingRequest,
  fixedUsdFee: number
): Promise<BigNumberJs> {
  const tokenContract = envelopingRequest.request.tokenContract;
  const gasPrice = envelopingRequest.relayData.gasPrice;

  const provider = getProvider();

  let symbol;
  let precision;
  if (tokenContract === constants.AddressZero) {
    symbol = 'RBTC';
    precision = 18;
  } else {
    const tokenInstance = ERC20__factory.connect(tokenContract, provider);
    symbol = await callERC20Symbol(tokenInstance);
    precision = await callERC20Decimals(tokenInstance);
  }

  const exchangeRate = await getExchangeRate(US_DOLLAR_SYMBOL, symbol);

  let fixedFeeInToken = exchangeRate.multipliedBy(fixedUsdFee);
  fixedFeeInToken = toPrecision({ value: fixedFeeInToken, precision });

  return await convertTokenToGas(fixedFeeInToken, tokenContract, gasPrice);
}

/*
 * Info about parsing data field:
 * - https://docs.soliditylang.org/en/latest/abi-spec.html#function-selector
 * - https://berndstrehl.medium.com/parsing-an-erc20-transfer-with-javascript-from-the-eth-api-2790da37e55f
 */
export async function calculateFeeFromTransfer(
  data: string,
  transferFeePercentage: number,
  envelopingRequest: EnvelopingRequest
): Promise<BigNumberJs> {
  if (!isTransferOrTransferFrom(data)) {
    return BigNumberJs(0);
  }

  const methodHash = getMethodHashFromData(data);

  const valueHex = data.substring(
    VALUE_INDEX_IN_DATA.get(methodHash) as number
  );

  const valueInDecimal = BigNumberJs('0x' + valueHex);

  const feeInToken = valueInDecimal.multipliedBy(transferFeePercentage);
  const tokenContract = envelopingRequest.request.tokenContract;
  const gasPrice = envelopingRequest.relayData.gasPrice;

  return await convertTokenToGas(feeInToken, tokenContract, gasPrice);
}

export function calculateFeeFromGas(
  maxPossibleGas: BigNumberishJs,
  feePercentage: BigNumberishJs
): BigNumberJs {
  const bigMaxPossibleGas = BigNumberJs(maxPossibleGas.toString());
  const bigFeePercentage = BigNumberJs(feePercentage.toString());

  return BigNumberJs(
    bigMaxPossibleGas.multipliedBy(bigFeePercentage).toFixed(0)
  );
}

export async function calculateFee(
  relayRequest: EnvelopingRequest,
  maxPossibleGas: BigNumber,
  appConfig: AppConfig
): Promise<BigNumberJs> {
  if (isSponsorshipAllowed(relayRequest, appConfig)) {
    return BigNumberJs(0);
  }

  const { fixedUsdFee } = appConfig;
  let fixedFee = BigNumberJs(0);

  if (fixedUsdFee) {
    fixedFee = await calculateFixedUsdFee(relayRequest, fixedUsdFee);

    log.debug(
      `Fixed USD fee applied. Value in USD: ${fixedUsdFee}, fee in gas: ${fixedFee.toString()}`
    );
  }

  const { transferFeePercentage } = appConfig;
  const data = relayRequest.request.data;
  //Even if transferFeePercentage = 0, it has priority over gas fee
  if (transferFeePercentage >= 0 && isTransferOrTransferFrom(data.toString())) {
    const transferFee = await calculateFeeFromTransfer(
      data.toString(),
      transferFeePercentage,
      relayRequest
    );

    log.debug(
      `Transfer fee applied. Fraction: ${transferFeePercentage}, value in gas: ${transferFee.toString()}`
    );

    return fixedFee.plus(transferFee);
  }

  const { gasFeePercentage } = appConfig;

  if (gasFeePercentage) {
    const gasFee = calculateFeeFromGas(
      maxPossibleGas.toString(),
      gasFeePercentage
    );
    log.debug(
      `Gas fee applied. Fraction: ${gasFeePercentage}, value in gas: ${gasFee.toString()}`
    );

    return fixedFee.plus(gasFee);
  }

  return fixedFee;
}

export default calculateFee;
