import type {
  Either,
  Modify,
} from '@rsksmart/rif-relay-client/dist/common/utility.types';
import type { BigNumberish } from 'ethers';
import type {
  RelayRequestBody as ClientRelayRequestBody,
  DeployRequestBody as ClientDeployRequestBody,
} from '@rsksmart/rif-relay-client';

// IMPORTANT: The types defined here mirror the types defined in the client.
//            see EnvelopingTxRequest in the rif-relay-client library

export declare type RelayRequestBody = Modify<
  ClientRelayRequestBody,
  {
    relayHub: string;
    from: string;
    to: string;
    tokenContract: string;
    value: BigNumberish;
    gas: BigNumberish;
    nonce: BigNumberish;
    tokenAmount: BigNumberish;
    tokenGas: BigNumberish;
    validUntilTime: BigNumberish;
    data: string;
  }
>;

export declare type DeployRequestBody = Modify<
  ClientDeployRequestBody,
  {
    relayHub: string;
    from: string;
    to: string;
    tokenContract: string;
    recoverer: string;
    value: BigNumberish;
    nonce: BigNumberish;
    tokenAmount: BigNumberish;
    tokenGas: BigNumberish;
    validUntilTime: BigNumberish;
    index: BigNumberish;
    data: string;
  }
>;

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
