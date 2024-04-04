import type { Either } from '@rsksmart/rif-relay-client/dist/common/utility.types';
import type { BigNumberish } from 'ethers';
import type {
  RelayRequestBody as ClientRelayRequestBody,
  DeployRequestBody as ClientDeployRequestBody,
} from '@rsksmart/rif-relay-client';

// IMPORTANT: The types defined here mirror the types defined in the client.
//            see EnvelopingTxRequest in the rif-relay-client library

type AwaitedWrapper<T> = { [P in keyof T]: Awaited<T[P]> };

export declare type RelayRequestBody = AwaitedWrapper<ClientRelayRequestBody>;

export declare type DeployRequestBody = AwaitedWrapper<ClientDeployRequestBody>;

export declare type EnvelopingMetadata = {
  relayHubAddress: RelayRequestBody['relayHub'];
  relayMaxNonce: number;
  signature: string;
};

export declare type EnvelopingRequestData = {
  gasPrice: BigNumberish;
  feesReceiver: string;
  callForwarder: string;
  callVerifier: string;
};

export declare type EnvelopingRequest = {
  request: Either<RelayRequestBody, DeployRequestBody>;
  relayData: EnvelopingRequestData;
};

export declare type HttpEnvelopingRequest = {
  relayRequest: EnvelopingRequest;
  metadata: EnvelopingMetadata;
};
