import {
  estimateInternalCallGas,
  isDeployRequest,
} from '@rsksmart/rif-relay-client';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import type { HttpEnvelopingRequest, RelayRequestBody } from '../definitions';
import { MAX_ESTIMATED_GAS_DEVIATION } from '../definitions/server.const';

export async function validateIfGasAmountIsAcceptable({
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

export default validateIfGasAmountIsAcceptable;
