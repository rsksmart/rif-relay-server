import {
    constants,
    ContractInteractor,
    DeployTransactionRequest,
    ERC20Token,
    estimateMaxPossibleRelayCallWithLinearFit,
    RelayTransactionRequest
} from '@rsksmart/rif-relay-common';
import {
    DeployRequest,
    DeployRequestStruct,
    ForwardRequest,
    RelayRequest
} from '@rsksmart/rif-relay-contracts';
import BigNumber from 'bignumber.js';
import { toWei } from 'web3-utils';

// If by any chance the tokenEstimation its zero, a value of 12000 its added to the estimation to include the subsidy scenario
const SUBSIDY = BigNumber(12000);

export const estimateRelayMaxPossibleGas = async (
    contractInteractor: ContractInteractor,
    request: RelayTransactionRequest | DeployTransactionRequest,
    relayWorkerAddress: string
): Promise<BigNumber> => {
    const { relayRequest, metadata } = request;

    const tokenEstimation = await estimateMaxPossibleGasTokenTransfer(
        contractInteractor,
        relayRequest
    );

    if (metadata.signature > '0x0') {
        return await standardMaxPossibleGasEstimation(
            contractInteractor,
            request,
            relayWorkerAddress,
            tokenEstimation
        );
    }

    return await linearFitMaxPossibleGasEstimation(
        contractInteractor,
        relayRequest,
        tokenEstimation
    );
};

const isDeployRequest = (
    request: DeployRequestStruct | ForwardRequest
): boolean => {
    return 'index' in request;
};

export const standardMaxPossibleGasEstimation = async (
    contractInteractor: ContractInteractor,
    {
        relayRequest,
        metadata: { signature }
    }: RelayTransactionRequest | DeployTransactionRequest,
    relayWorkerAddress: string,
    tokenEstimation: BigNumber
): Promise<BigNumber> => {
    const { request, relayData } = relayRequest;

    const hubMethod = isDeployRequest(request) ? 'deployCall' : 'relayCall';
    const methodToEstimate =
        contractInteractor.relayHubInstance.contract.methods[hubMethod](
            relayRequest,
            signature
        );

    const relayEstimation = await methodToEstimate.estimateGas({
        from: relayWorkerAddress,
        gasPrice: relayData.gasPrice
    });

    const correctedEstimation = applyGasCorrectionFactor(relayEstimation);

    return tokenEstimation.plus(correctedEstimation);
};

export const linearFitMaxPossibleGasEstimation = async (
    contractInteractor: ContractInteractor,
    { request, relayData }: RelayRequest | DeployRequest,
    tokenEstimation: BigNumber
): Promise<BigNumber> => {
    if (isDeployRequest(request)) {
        throw Error('LinearFit estimation not implemented for deployments');
    }

    const internalEstimation = await contractInteractor.estimateGas({
        from: relayData.callForwarder,
        to: request.to,
        data: request.data,
        gasPrice: relayData.gasPrice
    });

    const estimation = applyInternalCorrection(internalEstimation);

    const relayEstimation = estimateMaxPossibleRelayCallWithLinearFit(
        estimation.toNumber(),
        tokenEstimation.toNumber()
    );

    return BigNumber(relayEstimation);
};

export const estimateMaxPossibleGasTokenTransfer = async (
    contractInteractor: ContractInteractor,
    { request, relayData }: RelayRequest | DeployRequest
): Promise<BigNumber> => {
    const isDeployCall = isDeployRequest(request);
    let tokenEstimation: BigNumber;
    const gasInRequest = BigNumber(request.tokenGas);
    if (gasInRequest.gt(0)) {
        tokenEstimation = BigNumber(gasInRequest);
    } else {
        const erc20: ERC20Token = await contractInteractor.getERC20Token(
            request.tokenContract
        );

        const methodToEstimate = await erc20.instance.contract.methods.transfer(
            relayData.feesReceiver,
            toWei('1')
        );

        const { from, recoverer, index } = request as DeployRequestStruct;
        const caller = isDeployCall
            ? await contractInteractor.getSmartWalletAddress(
                  relayData.callForwarder,
                  from,
                  recoverer,
                  index
              )
            : relayData.callForwarder;

        const estimation = await methodToEstimate.estimateGas({
            from: caller,
            gasPrice: relayData.gasPrice
        });

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
    estimation: BigNumber | number | string
): BigNumber => {
    const bigValue = BigNumber(estimation);
    const correction = BigNumber(
        constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
    );
    if (bigValue.gte(correction)) {
        return bigValue.minus(correction);
    }
    return bigValue;
};

//TODO add link to the rskj misscalculation correction
/**
 * Applies the correction from the RSK node misscalculation if execution includes refunds
 */
export const applyGasCorrectionFactor = (
    estimation: BigNumber | number | string
): BigNumber => {
    const bigValue = BigNumber(estimation);
    if (constants.ESTIMATED_GAS_CORRECTION_FACTOR !== 1) {
        return bigValue.multipliedBy(constants.ESTIMATED_GAS_CORRECTION_FACTOR);
    }
    return bigValue;
};
