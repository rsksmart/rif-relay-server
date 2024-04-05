import { getProvider } from '../Utils';
import { TokenHandler__factory } from '@rsksmart/rif-relay-contracts';
import log from 'loglevel';

export async function getAcceptedTokensFromVerifier(
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

export default getAcceptedTokensFromVerifier;
