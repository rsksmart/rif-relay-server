import { getProvider } from '../Utils';
import { DestinationContractHandler__factory } from '@rsksmart/rif-relay-contracts';
import log from 'loglevel';

export async function getAcceptedContractsFromVerifier(
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

export default getAcceptedContractsFromVerifier;
