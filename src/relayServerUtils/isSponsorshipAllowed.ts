import type { AppConfig } from '../ServerConfigParams';
import type { EnvelopingRequest } from '../definitions/HttpEnvelopingRequest';

export function isSponsorshipAllowed(
  envelopingRequest: EnvelopingRequest,
  config: AppConfig
): boolean {
  const { disableSponsoredTx, sponsoredDestinations } = config;

  return (
    !disableSponsoredTx ||
    sponsoredDestinations.includes(envelopingRequest.request.to)
  );
}

export default isSponsorshipAllowed;
