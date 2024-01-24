import {
  EnvelopingRequest,
  estimateInternalCallGas,
  getExchangeRate,
  EnvelopingTxRequest,
} from '@rsksmart/rif-relay-client';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import { constants, BigNumber, type BigNumberish } from 'ethers';
import { MAX_ESTIMATED_GAS_DEVIATION } from './definitions/server.const';
import { getProvider } from './Utils';
import { ERC20__factory, PromiseOrValue } from '@rsksmart/rif-relay-contracts';
import type ExchangeToken from './definitions/token.type';
import {
  convertGasToNative,
  convertGasToToken,
  getXRateFor,
  toNativeWeiFrom,
  toPrecision,
} from './Conversions';
import log from 'loglevel';
import { INSUFFICIENT_TOKEN_AMOUNT } from './definitions/errorMessages.const';
import type { AppConfig } from './ServerConfigParams';

const TRANSFER_HASH = 'a9059cbb';
const TRANSFER_FROM_HASH = '23b872dd';
const INDEX_WHERE_VALUE_STARTS_ON_TRANSFER = 74;
const INDEX_WHERE_VALUE_STARTS_ON_TRANSFER_FROM = 138;
const US_DOLLAR_SYMBOL = 'USD';

const VALUE_INDEX_IN_DATA = new Map<string, number>();
VALUE_INDEX_IN_DATA.set(TRANSFER_HASH, INDEX_WHERE_VALUE_STARTS_ON_TRANSFER);
VALUE_INDEX_IN_DATA.set(
  TRANSFER_FROM_HASH,
  INDEX_WHERE_VALUE_STARTS_ON_TRANSFER_FROM
);

async function calculateFee(
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
  const data = await relayRequest.request.data;
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

async function calculateFixedUsdFee(
  envelopingRequest: EnvelopingRequest,
  fixedUsdFee: number
) {
  const tokenContractAddress = await envelopingRequest.request.tokenContract;
  const gasPrice = await envelopingRequest.relayData.gasPrice;

  const provider = getProvider();

  let symbol;
  let precision;
  if (tokenContractAddress === constants.AddressZero) {
    symbol = 'RBTC';
    precision = 18;
  } else {
    const tokenInstance = ERC20__factory.connect(
      tokenContractAddress,
      provider
    );
    symbol = await tokenInstance.symbol();
    precision = await tokenInstance.decimals();
  }

  const exchangeRate = await getExchangeRate(US_DOLLAR_SYMBOL, symbol);

  let fixedFeeInToken = exchangeRate.multipliedBy(fixedUsdFee);
  fixedFeeInToken = toPrecision({ value: fixedFeeInToken, precision });

  return await convertTokenToGas(
    fixedFeeInToken.toString(),
    tokenContractAddress,
    gasPrice.toString()
  );
}

/*
 * Info about parsing data field:
 * - https://docs.soliditylang.org/en/latest/abi-spec.html#function-selector
 * - https://berndstrehl.medium.com/parsing-an-erc20-transfer-with-javascript-from-the-eth-api-2790da37e55f
 */
async function calculateFeeFromTransfer(
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
  const tokenContractAddress = await envelopingRequest.request.tokenContract;
  const gasPrice = await envelopingRequest.relayData.gasPrice;

  return await convertTokenToGas(
    feeInToken.toString(),
    tokenContractAddress,
    gasPrice.toString()
  );
}

function calculateFeeFromGas(
  maxPossibleGas: BigNumberish,
  feePercentage: BigNumberish
): BigNumberJs {
  const bigMaxPossibleGas = BigNumberJs(maxPossibleGas.toString());
  const bigFeePercentage = BigNumberJs(feePercentage.toString());

  return BigNumberJs(
    bigMaxPossibleGas.multipliedBy(bigFeePercentage).toFixed(0)
  );
}

function isSponsorshipAllowed(
  envelopingRequest: EnvelopingRequest,
  config: AppConfig
): boolean {
  const { disableSponsoredTx, sponsoredDestinations } = config;

  return (
    !disableSponsoredTx ||
    sponsoredDestinations.includes(envelopingRequest.request.to as string)
  );
}

function getMethodHashFromData(data: string) {
  return data.substring(2, 10);
}

async function validateIfGasAmountIsAcceptable({
  relayRequest: { request, relayData },
}: EnvelopingTxRequest) {
  // TODO: For RIF Team
  // The maxPossibleGas must be compared against the commitment signed with the user.
  // The relayServer must not allow a call that requires more gas than it was agreed with the user
  // For now, we can call estimateDestinationContractCallGas to get the "ACTUAL" gas required for the
  // field req.relayRequest.request.gas and not relay requests that deviated too much from what the user signed

  // But take into account that the agreement with the user (the one from the Arbiter) has the final decision.
  // If the Relayer agreed with the Client a certain percentage of deviation from the original maxGas, then it must honor that agreement
  // and not the current hardcoded deviation

  if (request.to == constants.AddressZero) {
    return;
  }

  const estimatedDestinationGasCost = await estimateInternalCallGas({
    from: relayData.callForwarder,
    to: request.to,
    gasPrice: relayData.gasPrice,
    data: request.data,
  });

  const bigMaxEstimatedGasDeviation = BigNumberJs(
    1 + MAX_ESTIMATED_GAS_DEVIATION
  );

  const { gas } = request;
  const gasValue = await gas;
  const bigGasFromRequestMaxAgreed = bigMaxEstimatedGasDeviation.multipliedBy(
    gasValue.toString()
  );

  if (estimatedDestinationGasCost.gt(bigGasFromRequestMaxAgreed.toFixed(0))) {
    throw new Error(
      "Request payload's gas parameters deviate too much fom the estimated gas for this transaction"
    );
  }
}

async function validateIfTokenAmountIsAcceptable(
  maxPossibleGas: BigNumber,
  envelopingTransaction: EnvelopingTxRequest,
  appConfig: AppConfig
) {
  if (isSponsorshipAllowed(envelopingTransaction.relayRequest, appConfig)) {
    return;
  }

  const {
    request: { tokenAmount, tokenContract },
    relayData: { gasPrice },
  } = envelopingTransaction.relayRequest;

  const tokenContractAddress = await tokenContract;
  const tokenAmountValue = await tokenAmount;
  const gasPriceValue = await gasPrice;

  let tokenAmountInGas = BigNumberJs(tokenAmountValue.toString());
  if (tokenContractAddress !== constants.AddressZero) {
    tokenAmountInGas = await convertTokenToGas(
      tokenAmountValue.toString(),
      tokenContractAddress,
      gasPriceValue.toString()
    );
  }

  const isTokenAmountAcceptable = tokenAmountInGas.isGreaterThanOrEqualTo(
    maxPossibleGas.toString()
  );

  log.debug(
    'TokenAmount in gas agreed by the user',
    tokenAmountInGas.toString()
  );
  log.debug(
    'MaxPossibleGas including fees required by the transaction',
    maxPossibleGas.toString()
  );
  log.debug('RequestFees - isTokenAmountAcceptable? ', isTokenAmountAcceptable);

  if (!isTokenAmountAcceptable) {
    throw new Error(INSUFFICIENT_TOKEN_AMOUNT);
  }
}

async function convertTokenToGas(
  tokenAmount: string,
  tokenAddress: string,
  gasPrice: string
) {
  const provider = getProvider();

  const tokenInstance = ERC20__factory.connect(tokenAddress, provider);

  const token: ExchangeToken = {
    instance: tokenInstance,
    name: await tokenInstance.name(),
    symbol: await tokenInstance.symbol(),
    decimals: await tokenInstance.decimals(),
  };

  const xRate = await getXRateFor(token);

  const tokenAmountInNative = toNativeWeiFrom({
    ...token,
    amount: tokenAmount,
    xRate,
  });

  const bigTokenAmountInNative = BigNumberJs(tokenAmountInNative.toString());

  return bigTokenAmountInNative.dividedBy(gasPrice);
}

function isTransferOrTransferFrom(data: string) {
  const methodHash = getMethodHashFromData(data);

  return VALUE_INDEX_IN_DATA.has(methodHash);
}

async function convertGasToTokenAndNative(
  relayRequest: EnvelopingRequest,
  initialEstimation: BigNumber
) {
  const gasPrice = await relayRequest.relayData.gasPrice;
  const tokenContractAddress = await relayRequest.request.tokenContract;

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
      symbol: await tokenInstance.symbol(),
      decimals: await tokenInstance.decimals(),
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

function secondsToDate(dateInSeconds: number) {
  return new Date(dateInSeconds * 1000);
}

async function validateExpirationTime(
  validUntilTime: PromiseOrValue<BigNumberish>,
  requestMinValidSeconds: number
) {
  const validUntilTimeValue = await validUntilTime;
  const secondsNow = Math.round(Date.now() / 1000);
  const expiredInSeconds =
    parseInt(validUntilTimeValue.toString()) - secondsNow;
  if (expiredInSeconds < requestMinValidSeconds) {
    const expirationDate = secondsToDate(
      parseInt(validUntilTimeValue.toString())
    );
    throw new Error(
      `Request expired (or too close): expiration date received "${expirationDate.toUTCString()}" is expected to be greater than or equal to "${secondsToDate(
        secondsNow + requestMinValidSeconds
      ).toUTCString()}"`
    );
  }
}

export {
  validateIfGasAmountIsAcceptable,
  validateIfTokenAmountIsAcceptable,
  calculateFee,
  convertGasToTokenAndNative,
  isSponsorshipAllowed,
  TRANSFER_HASH,
  TRANSFER_FROM_HASH,
  validateExpirationTime,
};
