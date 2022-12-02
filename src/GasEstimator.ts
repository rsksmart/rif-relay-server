import {
  DeployTransactionRequest,
  ESTIMATED_GAS_CORRECTION_FACTOR,
  INTERNAL_TRANSACTION_ESTIMATE_CORRECTION,
  RelayTransactionRequest,
} from '@rsksmart/rif-relay-common';
import {
  EnvelopingTypes,
  ERC20__factory,
  IForwarderTypes,
  ISmartWalletFactory__factory,
  RelayHub__factory,
} from '@rsksmart/rif-relay-contracts';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import type { Provider } from '@ethersproject/providers';
import { BigNumber, BigNumberish, utils } from 'ethers';
import { estimateMaxPossibleRelayCallWithLinearFit } from './Utils';
import { parseToBigNumber } from './Conversions';

// If by any chance the tokenEstimation its zero, a value of 12000 its added to the estimation to include the subsidy scenario
const SUBSIDY = BigNumber.from(12000);

export const estimateRelayMaxPossibleGas = async (
  provider: Provider,
  request: RelayTransactionRequest | DeployTransactionRequest,
  relayWorkerAddress: string
): Promise<BigNumber> => {
  const {
    relayRequest,
    metadata: { signature },
  } = request;

  const tokenEstimation = await estimateMaxPossibleGasTokenTransfer(
    provider,
    relayRequest
  );

  if (signature > '0x0') {
    return await standardMaxPossibleGasEstimation(
      provider,
      request,
      relayWorkerAddress,
      tokenEstimation
    );
  }

  return await linearFitMaxPossibleGasEstimation(
    provider,
    relayRequest,
    tokenEstimation
  );
};

const isDeployRequest = (
  relayRequest:
    | IForwarderTypes.DeployRequestStruct
    | IForwarderTypes.ForwardRequestStruct
): boolean => {
  return 'index' in relayRequest;
};

export const standardMaxPossibleGasEstimation = async (
  provider: Provider,
  {
    relayRequest,
    metadata: { signature },
  }: RelayTransactionRequest | DeployTransactionRequest,
  relayWorkerAddress: string,
  tokenEstimation: BigNumber
): Promise<BigNumber> => {
  const { request, relayData } = relayRequest;

  const relayHub = RelayHub__factory.connect(
    request.relayHub as string,
    provider
  );

  const methodToEstimate = isDeployRequest(request)
    ? await relayHub.populateTransaction.deployCall(
        relayRequest as EnvelopingTypes.DeployRequestStruct,
        signature
      )
    : await relayHub.populateTransaction.relayCall(
        relayRequest as EnvelopingTypes.RelayRequestStruct,
        signature
      );

  const relayEstimation = await provider.estimateGas({
    ...methodToEstimate,
    gasPrice: relayData.gasPrice,
    from: relayWorkerAddress,
  });

  const correctedEstimation = applyGasCorrectionFactor(relayEstimation);

  return tokenEstimation.add(correctedEstimation);
};

export const linearFitMaxPossibleGasEstimation = async (
  provider: Provider,
  {
    request,
    relayData,
  }: EnvelopingTypes.RelayRequestStruct | EnvelopingTypes.DeployRequestStruct,
  tokenEstimation: BigNumber
): Promise<BigNumber> => {
  if (isDeployRequest(request)) {
    throw Error('LinearFit estimation not implemented for deployments');
  }

  const internalEstimation = await provider.estimateGas({
    from: relayData.callForwarder,
    to: request.to,
    data: request.data,
    gasPrice: relayData.gasPrice,
  });

  const estimation = applyInternalCorrection(internalEstimation);

  const relayEstimation = estimateMaxPossibleRelayCallWithLinearFit(
    estimation.toNumber(),
    tokenEstimation.toNumber()
  );

  return relayEstimation;
};

export const estimateMaxPossibleGasTokenTransfer = async (
  provider: Provider,
  {
    request,
    relayData,
  }: EnvelopingTypes.RelayRequestStruct | EnvelopingTypes.DeployRequestStruct
): Promise<BigNumber> => {
  const isDeployCall = isDeployRequest(request);
  let tokenEstimation: BigNumber;
  const gasInRequest = BigNumber.from(request.tokenGas);
  if (gasInRequest.gt(0)) {
    tokenEstimation = gasInRequest;
  } else {
    let executer = relayData.callForwarder as string;
    if (isDeployCall) {
      const { from, recoverer, index } =
        request as IForwarderTypes.DeployRequestStruct;
      const smartWalletFactory = ISmartWalletFactory__factory.connect(
        executer,
        provider
      );
      executer = await smartWalletFactory.getSmartWalletAddress(
        from,
        recoverer,
        index
      );
    }

    const erc20 = ERC20__factory.connect(
      request.tokenContract as string,
      provider
    );

    const estimation = await erc20.estimateGas.transfer(
      relayData.feesReceiver,
      utils.formatUnits(1, 'wei'),
      {
        from: executer,
        gasPrice: relayData.gasPrice,
      }
    );

    tokenEstimation = applyInternalCorrection(estimation);
  }

  if (tokenEstimation.isZero() && isDeployCall) {
    return SUBSIDY;
  }

  return applyGasCorrectionFactor(tokenEstimation);
};

/**
 * Applies the correction from internal calls. When estimating the gas that an internal call is going to spend, we need to substract some gas inherent to send the parameters to the blockchain
 */
export const applyInternalCorrection = (
  estimation: BigNumberish
): BigNumber => {
  let bigValue = BigNumberJs(estimation.toString());
  const bigCorrection = BigNumberJs(
    INTERNAL_TRANSACTION_ESTIMATE_CORRECTION.toString()
  );

  if (bigValue.gte(bigCorrection)) {
    bigValue = bigValue.minus(bigCorrection);
  }

  return parseToBigNumber(bigValue);
};

//TODO add link to the rskj misscalculation correction
/**
 * Applies the correction from the RSK node misscalculation if execution includes refunds
 */
export const applyGasCorrectionFactor = (
  estimation: BigNumberish
): BigNumber => {
  let bigEstimation = BigNumberJs(estimation.toString());
  const bigGasCorrection = BigNumberJs(
    ESTIMATED_GAS_CORRECTION_FACTOR.toString()
  );

  if (!bigGasCorrection.isEqualTo(1)) {
    bigEstimation = bigEstimation.multipliedBy(bigGasCorrection);
  }

  return parseToBigNumber(bigEstimation.toFixed());
};
