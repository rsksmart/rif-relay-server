import {
    constants,
    ContractInteractor,
    DeployTransactionRequest,
    ERC20Token,
    EstimateGasParams,
    estimateMaxPossibleRelayCallWithLinearFit,
    RelayTransactionRequest
} from '@rsksmart/rif-relay-common';
import { DeployRequest, RelayRequest } from '@rsksmart/rif-relay-contracts';
import BigNumber from 'bignumber.js';
import { toWei } from 'web3-utils';

const SUBSIDY = BigNumber(12000);

/**
 * Estimates the gas consume by relaying a transaction using either a linearFit/standard estimation
 * @param contractInteractor object containing the contractInteractor
 * @param request request that contains the relayRequest/deployRequest and metadata
 * @param relayWorker address of the relayWorker that will execute the transaction
 * @returns gas estimation from the relayTransaction 
 */
export const estimateGasRelayTransaction = async (
    contractInteractor: ContractInteractor,
    request: RelayTransactionRequest | DeployTransactionRequest,
    relayWorker: string
): Promise<BigNumber> => {
    const { relayRequest, metadata } = request;

    let estimation: BigNumber;

    const tokenEstimation = await estimateGasTokenTransfer(
        contractInteractor,
        relayRequest
    );

    if (checkSignature(metadata.signature)) {
        estimation = await estandardGasEstimation(
            contractInteractor,
            request,
            relayWorker,
            tokenEstimation
        );
    } else {
        estimation = await linearFitGasEstimation(
            contractInteractor,
            relayRequest,
            tokenEstimation
        );
    }

    return estimation;
};

const checkSignature = (signature: string): boolean => {
    const bigValue: BigNumber = new BigNumber(signature, 16);
    if (!bigValue.isZero()) {
        return true;
    }
    return false;
};

/**
 * Estimates the gas consume by relaying a transaction using a standard estimation
 * @param contractInteractor object containing the contractInteractor
 * @param request request that contains the relayRequest/deployRequest and metadata
 * @param relayWorker address of the relayWorker that will execute the transaction
 * @param tokenEstimation gas consume by the token transfer
 * @returns gas estimation from the relayTransaction
 */
export const estandardGasEstimation = async (
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
    if ('index' in request) {
        methodToEstimate =
            await contractInteractor.relayHubInstance.contract.methods.deployCall(
                relayRequest as DeployRequest,
                metadata.signature
            );
    } else {
        methodToEstimate =
            await contractInteractor.relayHubInstance.contract.methods.relayCall(
                relayRequest as RelayRequest,
                metadata.signature
            );
    }

    const relayEstimation = await methodToEstimate.estimateGas({
        from: relayWorker,
        gasPrice: relayData.gasPrice
    });

    return tokenEstimation.plus(applyGasCorrectionFactor(relayEstimation));
};


/**
 * Estimates the gas consume by relaying a transaction using a linearFit
 * @param contractInteractor object containing the contractInteractor
 * @param request request that contains the relayRequest/deployRequest and metadata
 * @param tokenEstimation gas consume by the token transfer
 * @returns gas estimation from the relayTransaction 
 */
export const linearFitGasEstimation = async (
    contractInteractor: ContractInteractor,
    { request, relayData }: RelayRequest | DeployRequest,
    tokenEstimation: BigNumber
): Promise<BigNumber> => {

    let internalEstimation: BigNumber;

    if ('index' in request) {
        throw Error('LinearFit estimation not implemented for deployments');
    }

    internalEstimation = await estimateGasDestination(
        contractInteractor,
        {
            from: request.from,
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
 * Estimates the gas consume by transfering an ERC20 token
 * @param contractInteractor object containing the contractInteractor
 * @param request request that contains the relayRequest/deployRequest and metadata
 * @returns gas estimation from the transfer
 */
export const estimateGasTokenTransfer = async (
    contractInteractor: ContractInteractor,
    { request, relayData }: RelayRequest | DeployRequest
): Promise<BigNumber> => {
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
        if ('index' in request) {
            const { from, recoverer, index } = request;
            caller = await contractInteractor.getSmartWalletAddress(caller, from, recoverer, index);
        }

        const estimation = await methodToEstimate.estimateGas({
            from: caller,
            gasPrice: relayData.gasPrice
        });

        tokenEstimation = applyInternalCorrection(estimation);
    }

    if (tokenEstimation.isZero()) {
        return SUBSIDY;
    }

    return applyGasCorrectionFactor(tokenEstimation);
};


/**
 * Estimates the gas consume by executing a function
 * @param contractInteractor object containing the contractInteractor
 * @param estimate params to execute the estimateGas function
 * @returns gas estimation from the execution
 */
export const estimateGasDestination = async (
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
 * Applies the correction from the RSK node miscalculation
 * @param estimation BigNumber gas estimation that needs to be corrected
 * @returns gas estimation with the correction done
 */
export const applyGasCorrectionFactor = (estimation: BigNumber | number | string) => {
    const bigValue = BigNumber(estimation);
    return bigValue.multipliedBy(constants.ESTIMATED_GAS_CORRECTION_FACTOR);
};