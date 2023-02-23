import {
  EnvelopingRequest,
  estimateInternalCallGas,
  RelayRequest,
} from '@rsksmart/rif-relay-client';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import type { BigNumber, BigNumberish } from 'ethers';
import { MAX_ESTIMATED_GAS_DEVIATION } from './definitions/server.const';
import { getProvider } from './Utils';
import { ERC20__factory } from '@rsksmart/rif-relay-contracts';
import type ExchangeToken from './definitions/token.type';
import {
  convertGasToNative,
  convertGasToToken,
  getXRateFor,
  toNativeWeiFrom,
} from './Conversions';
import log from 'loglevel';
import { INSUFFICIENT_TOKEN_AMOUNT } from './definitions/errorMessages.const';
import type { AppConfig } from './ServerConfigParams';

const TRANSFER_HASH = 'a9059cbb';
const TRANSFER_FROM_HASH = '23b872dd';
const INDEX_WHERE_VALUE_STARTS_ON_TRANSFER = 74;
const INDEX_WHERE_VALUE_STARTS_ON_TRANSFER_FROM = 138;

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
) {
  const { transferFeePercentage } = appConfig;

  if (
    transferFeePercentage >= 0 &&
    isTransferOrTransferFrom(relayRequest.request.data.toString())
  ) {
    const feeInToken = calculateFeeFromTransfer(
      relayRequest.request.data.toString(),
      transferFeePercentage
    );
    log.debug(
      `Transfer fee applied. Fraction: ${transferFeePercentage}, fee in tokens: ${feeInToken.toString()}`
    );

    return await convertTokenToGas(
      feeInToken.toString(),
      relayRequest.request.tokenContract.toString(),
      relayRequest.relayData.gasPrice.toString()
    );
  }

  const { gasFeePercentage } = appConfig;
  log.debug(`Gas fee applied. Fraction: ${gasFeePercentage}`);

  return calculateFeeFromGas(maxPossibleGas.toString(), gasFeePercentage);
}

/*
 * Info about parsing data field:
 * - https://docs.soliditylang.org/en/latest/abi-spec.html#function-selector
 * - https://berndstrehl.medium.com/parsing-an-erc20-transfer-with-javascript-from-the-eth-api-2790da37e55f
 */
function calculateFeeFromTransfer(
  data: string,
  transferFeePercentage: number
): BigNumberJs {
  if (!isTransferOrTransferFrom(data)) {
    return BigNumberJs(0);
  }

  const methodHash = getMethodHashFromData(data);

  const valueHex = data.substring(
    VALUE_INDEX_IN_DATA.get(methodHash) as number
  );

  const valueInDecimal = BigNumberJs('0x' + valueHex);

  return valueInDecimal.multipliedBy(transferFeePercentage);
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

function getMethodHashFromData(data: string) {
  return data.substring(2, 10);
}

async function validateIfGasAmountIsAcceptable(relayRequest: RelayRequest) {
  // TODO: For RIF Team
  // The maxPossibleGas must be compared against the commitment signed with the user.
  // The relayServer must not allow a call that requires more gas than it was agreed with the user
  // For now, we can call estimateDestinationContractCallGas to get the "ACTUAL" gas required for the
  // field req.relayRequest.request.gas and not relay requests that deviated too much from what the user signed

  // But take into acconunt that the aggreement with the user (the one from the Arbiter) has the final decision.
  // If the Relayer agreed with the Client a certain percentage of deviation from the original maxGas, then it must honor that agreement
  // and not the current hardcoded deviation

  const estimatedDestinationGasCost = await estimateInternalCallGas({
    from: relayRequest.relayData.callForwarder.toString(),
    to: relayRequest.request.to.toString(),
    gasPrice: relayRequest.relayData.gasPrice,
    data: relayRequest.request.data,
  });

  const bigMaxEstimatedGasDeviation = BigNumberJs(
    1 + MAX_ESTIMATED_GAS_DEVIATION
  );

  const bigGasFromRequestMaxAgreed = bigMaxEstimatedGasDeviation.multipliedBy(
    relayRequest.request.gas.toString()
  );

  if (estimatedDestinationGasCost.gt(bigGasFromRequestMaxAgreed.toFixed(0))) {
    throw new Error(
      "Request payload's gas parameters deviate too much fom the estimated gas for this transaction"
    );
  }
}

async function validateIfTokenAmountIsAcceptable(
  maxPossibleGas: BigNumber,
  tokenAmount: string,
  tokenContract: string,
  gasPrice: string
) {
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
  const gasPrice = relayRequest.relayData.gasPrice.toString();

  const provider = getProvider();

  const tokenInstance = ERC20__factory.connect(
    relayRequest.request.tokenContract.toString(),
    provider
  );

  const token: ExchangeToken = {
    instance: tokenInstance,
    name: await tokenInstance.name(),
    symbol: await tokenInstance.symbol(),
    decimals: await tokenInstance.decimals(),
  };

  const xRate = await getXRateFor(token);

  const initialEstimationInToken = convertGasToToken(
    initialEstimation,
    { ...token, xRate },
    gasPrice
  );

  const initialEstimationInNative = convertGasToNative(
    initialEstimation,
    gasPrice
  );

  return {
    value: initialEstimation.toString(),
    valueInToken: initialEstimationInToken.toString(),
    valueInNative: initialEstimationInNative.toString(),
    exchangeRate: xRate,
    gasPrice,
  };
}

export {
  validateIfGasAmountIsAcceptable,
  validateIfTokenAmountIsAcceptable,
  calculateFee,
  convertGasToTokenAndNative,
  TRANSFER_HASH,
  TRANSFER_FROM_HASH,
};
