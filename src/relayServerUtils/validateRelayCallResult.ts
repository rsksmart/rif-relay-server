import { relayHubInterface } from '../Utils';

/**
 * Checks what RelayHub.relayCall returned in the dry run. A call that runs
 * out of gas on Rootstock returns no data instead of an error, and reverts
 * once mined at the worker's cost. A destination call that fails returns
 * false: a sponsored request then earns the worker nothing, and a paid one
 * charges its user a fee for a call that does nothing, so both are refused.
 * deployCall returns nothing, so it cannot be checked this way.
 * @param result The data the dry run of relayCall returned.
 */
export function validateRelayCallResult(result: string): void {
  let destinationCallSuccess: boolean;
  try {
    [destinationCallSuccess] = relayHubInterface.decodeFunctionResult(
      'relayCall',
      result
    ) as unknown as [boolean];
  } catch {
    throw new Error(
      `The relay call returned no result in the dry run (as when it runs out of gas): ${result}`
    );
  }

  if (!destinationCallSuccess) {
    throw new Error('The destination call fails in the dry run');
  }
}

export default validateRelayCallResult;
