import {
    constants,
    ContractInteractor,
    DeployTransactionRequest,
    ERC20Token,
    EstimateGasParams,
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

const SUBSIDY = BigNumber(12000);

/**
 * Estimates the max possible gas consumed by relaying a transaction using either a linearFit/standard estimation
 * @param contractInteractor object containing the contractInteractor
 * @param request request that contains the relayRequest/deployRequest and metadata
 * @param relayWorker address of the relayWorker that will execute the transaction
 * @returns gas estimation from the relayTransaction
 */
export const estimateMaxPossibleGas = async (
    contractInteractor: ContractInteractor,
    request: RelayTransactionRequest | DeployTransactionRequest,
    relayWorker: string
): Promise<BigNumber> => {
    const { relayRequest, metadata } = request;

    let estimation: BigNumber;

    const tokenEstimation = await estimateMaxPossibleGasTokenTransfer(
        contractInteractor,
        relayRequest
    );

    if (checkSignature(metadata.signature)) {
        estimation = await standardMaxPossibleGasEstimation(
            contractInteractor,
            request,
            relayWorker,
            tokenEstimation
        );
    } else {
        estimation = await linearFitMaxPossibleGasEstimation(
            contractInteractor,
            relayRequest,
            tokenEstimation
        );
    }

    return estimation;
};

/**
 * Verify if the string contains a hexadecimal value bigger than 0
 * @param signature string that contains the signature
 * @returns boolean flag
 */
const checkSignature = (signature: string): boolean => {
    const bigValue = new BigNumber(signature, 16);
    if (!bigValue.isZero()) {
        return true;
    }
    return false;
};

/**
 * Verify if request is a deployment
 * @param request relay request
 * @returns boolean flag
 */
const isDeployRequest = (
    request: DeployRequestStruct | ForwardRequest
): boolean => {
    return 'index' in request;
};

/**
 * Estimates the max possible gas consumed by relaying a transaction using a standard estimation
 * @param contractInteractor object containing the contractInteractor
 * @param request request that contains the relayRequest/deployRequest and metadata
 * @param relayWorker address of the relayWorker that will execute the transaction
 * @param tokenEstimation gas consumed by the token transfer
 * @returns gas estimation from the relayTransaction
 */
export const standardMaxPossibleGasEstimation = async (
    contractInteractor: ContractInteractor,
    {
        relayRequest,
        metadata
    }: RelayTransactionRequest | DeployTransactionRequest,
    relayWorker: string,
    tokenEstimation: BigNumber
): Promise<BigNumber> => {
    const { request, relayData } = relayRequest;

    let methodToEstimate;
    if (isDeployRequest(request)) {
        methodToEstimate =
            contractInteractor.relayHubInstance.contract.methods.deployCall(
                relayRequest as DeployRequest,
                metadata.signature
            );
    } else {
        methodToEstimate =
            contractInteractor.relayHubInstance.contract.methods.relayCall(
                relayRequest as RelayRequest,
                metadata.signature
            );
    }

    const relayEstimation = await methodToEstimate.estimateGas({
        from: relayWorker,
        gasPrice: relayData.gasPrice
    });

    const correctedEstimation = applyGasCorrectionFactor(relayEstimation);

    return tokenEstimation.plus(correctedEstimation);
};

/**
 * Estimates the max possible gas consumed by relaying a transaction using a linearFit
 * @param contractInteractor object containing the contractInteractor
 * @param request request that contains the relayRequest/deployRequest and metadata
 * @param tokenEstimation gas consumed by the token transfer
 * @returns gas estimation from the relayTransaction
 */
export const linearFitMaxPossibleGasEstimation = async (
    contractInteractor: ContractInteractor,
    { request, relayData }: RelayRequest | DeployRequest,
    tokenEstimation: BigNumber
): Promise<BigNumber> => {
    let internalEstimation: BigNumber;

    if (isDeployRequest(request)) {
        throw Error('LinearFit estimation not implemented for deployments');
    }

    internalEstimation = await estimateMaxPossibleGasExecution(
        contractInteractor,
        {
            from: relayData.callForwarder,
            to: request.to,
            data: request.data,
            gasPrice: relayData.gasPrice
        }
    );

    internalEstimation = applyInternalCorrection(internalEstimation);

    const relayEstimation = estimateMaxPossibleRelayCallWithLinearFit(
        internalEstimation.toNumber(),
        tokenEstimation.toNumber()
    );

    return BigNumber(relayEstimation);
};

/**
 * Estimates the max possible gas consumed by transfering an ERC20 token
 * @param contractInteractor object containing the contractInteractor
 * @param request request that contains the relayRequest/deployRequest and metadata
 * @returns gas estimation from the transfer
 */
export const estimateMaxPossibleGasTokenTransfer = async (
    contractInteractor: ContractInteractor,
    { request, relayData }: RelayRequest | DeployRequest
): Promise<BigNumber> => {
    const deploy = isDeployRequest(request);
    let tokenEstimation: BigNumber;
    const tokenGas = BigNumber(request.tokenGas);
    if (tokenGas.gt(0)) {
        tokenEstimation = BigNumber(request.tokenGas);
    } else {
        const erc20: ERC20Token = await contractInteractor.getERC20Token(
            request.tokenContract
        );

        const methodToEstimate = await erc20.instance.contract.methods.transfer(
            relayData.feesReceiver,
            toWei('1')
        );

        let caller = relayData.callForwarder;
        if (deploy) {
            const { from, recoverer, index } = request as DeployRequestStruct;
            caller = await contractInteractor.getSmartWalletAddress(
                caller,
                from,
                recoverer,
                index
            );
        }

        const estimation = await methodToEstimate.estimateGas({
            from: caller,
            gasPrice: relayData.gasPrice
        });

        tokenEstimation = applyInternalCorrection(estimation);
    }

    if (tokenEstimation.isZero() && deploy) {
        return SUBSIDY;
    }

    return applyGasCorrectionFactor(tokenEstimation);
};

/**
 * Estimates the max possible gas consumed by executing a function
 * @param contractInteractor object containing the contractInteractor
 * @param estimate params to execute the estimateGas function
 * @returns gas estimation from the execution
 */
export const estimateMaxPossibleGasExecution = async (
    contractInteractor: ContractInteractor,
    estimate: EstimateGasParams
): Promise<BigNumber> => {
    const estimation = await contractInteractor.estimateGas(estimate);
    return BigNumber(estimation);
};

/**
 * Applies the correction from internal calls
 * @param estimation BigNumber gas estimation that needs to be corrected
 * @returns gas estimation with the correction done
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

/**
 * Applies the correction from the RSK node misscalculation
 * @param estimation BigNumber gas estimation that needs to be corrected
 * @returns gas estimation with the correction done
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
