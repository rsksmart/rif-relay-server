import {
  estimateInternalCallGas,
  getExchangeRate,
  isDeployRequest,
} from '@rsksmart/rif-relay-client';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import { constants, BigNumber, type BigNumberish } from 'ethers';
import { MAX_ESTIMATED_GAS_DEVIATION } from './definitions/server.const';
import { getProvider } from './Utils';
import {
  DestinationContractHandler__factory,
  ERC20,
  ERC20__factory,
  PromiseOrValue,
  TokenHandler__factory,
} from '@rsksmart/rif-relay-contracts';
import type ExchangeToken from './definitions/token.type';
import {
  BigNumberishJs,
  convertGasToNative,
  convertGasToToken,
  getXRateFor,
  toNativeWeiFrom,
  toPrecision,
} from './Conversions';
import log from 'loglevel';
import { INSUFFICIENT_TOKEN_AMOUNT } from './definitions/errorMessages.const';
import type { AppConfig } from './ServerConfigParams';
import type {
  EnvelopingRequest,
  HttpEnvelopingRequest,
  RelayRequestBody,
} from './HttpEnvelopingRequest';

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

async function calculateFixedUsdFee(
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
  const tokenContract = envelopingRequest.request.tokenContract;
  const gasPrice = envelopingRequest.relayData.gasPrice;

  return await convertTokenToGas(feeInToken, tokenContract, gasPrice);
}

function calculateFeeFromGas(
  maxPossibleGas: BigNumberishJs,
  feePercentage: BigNumberishJs
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
    sponsoredDestinations.includes(envelopingRequest.request.to)
  );
}

function getMethodHashFromData(data: string) {
  return data.substring(2, 10);
}

async function validateIfGasAmountIsAcceptable({
  relayRequest,
}: HttpEnvelopingRequest) {
  // The maxPossibleGas must be compared against the commitment signed with the user.
  // The relayServer must not allow a call that requires more gas than it was agreed with the user
  // For now, we can call estimateDestinationContractCallGas to get the "ACTUAL" gas required for the
  // field req.relayRequest.request.gas and not relay requests that deviated too much from what the user signed

  // But take into account that the agreement with the user (the one from the Arbiter) has the final decision.
  // If the Relayer agreed with the Client a certain percentage of deviation from the original maxGas, then it must honor that agreement
  // and not the current hardcoded deviation

  if (isDeployRequest(relayRequest)) {
    return;
  }

  const { request, relayData } = relayRequest;

  const estimatedDestinationGasCost = await estimateInternalCallGas({
    from: relayData.callForwarder,
    to: request.to,
    gasPrice: relayData.gasPrice,
    data: request.data,
  });

  const bigMaxEstimatedGasDeviation = BigNumberJs(
    1 + MAX_ESTIMATED_GAS_DEVIATION
  );

  const { gas } = request as RelayRequestBody;
  const gasValue = gas;
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
  envelopingTransaction: HttpEnvelopingRequest,
  appConfig: AppConfig
) {
  if (isSponsorshipAllowed(envelopingTransaction.relayRequest, appConfig)) {
    return;
  }

  const { request, relayData } = envelopingTransaction.relayRequest;

  const tokenContract = request.tokenContract;
  const tokenAmount = request.tokenAmount;
  const gasPrice = relayData.gasPrice;

  const tokenAmountInGas = await convertTokenToGas(
    tokenAmount,
    tokenContract,
    gasPrice
  );

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

type ERC20OptionalMethod = 'symbol' | 'decimals' | 'name';

async function callERC20OptionalMethod<T>(
  tokenInstance: ERC20,
  methodName: ERC20OptionalMethod,
  defaultValue: T
): Promise<T> {
  try {
    return (await tokenInstance[methodName]()) as T;
  } catch (error) {
    log.warn(`ERC20 method ${methodName} failed`, error);

    return defaultValue;
  }
}

async function callERC20Symbol(tokenInstance: ERC20, defaultValue = 'ERC20') {
  return callERC20OptionalMethod(tokenInstance, 'symbol', defaultValue);
}

async function callERC20Decimals(tokenInstance: ERC20, defaultValue = 18) {
  return callERC20OptionalMethod(tokenInstance, 'decimals', defaultValue);
}

async function convertTokenToGas(
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

function isTransferOrTransferFrom(data: string) {
  const methodHash = getMethodHashFromData(data);

  return VALUE_INDEX_IN_DATA.has(methodHash);
}

async function convertGasToTokenAndNative(
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

async function getAcceptedContractsFromVerifier(
  verifier: string
): Promise<string[]> {
  try {
    const provider = getProvider();

    const handler = DestinationContractHandler__factory.connect(
      verifier,
      provider
    );

    return await handler.getAcceptedContracts();
  } catch (error) {
    log.warn(
      `Couldn't get accepted contracts from verifier ${verifier}`,
      error
    );
  }

  return [];
}

async function getAcceptedTokensFromVerifier(
  verifier: string
): Promise<string[]> {
  try {
    const provider = getProvider();
    const handler = TokenHandler__factory.connect(verifier, provider);

    return await handler.getAcceptedTokens();
  } catch (error) {
    log.warn(`Couldn't get accepted tokens from verifier ${verifier}`, error);
  }

  return [];
}

function queryVerifiers(verifier: string | undefined, verifiers: Set<string>) {
  // if no verifier was supplied, query all trusted verifiers
  if (!verifier) {
    return Array.from(verifiers);
  }

  // if a verifier was supplied, check that it is trusted
  if (!verifiers.has(verifier.toLowerCase())) {
    throw new Error('Supplied verifier is not trusted');
  }

  return [verifier];
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
  queryVerifiers,
  getAcceptedContractsFromVerifier,
  getAcceptedTokensFromVerifier,
};
