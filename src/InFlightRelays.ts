import { BigNumber, utils } from 'ethers';
import { RelayHub__factory } from '@rsksmart/rif-relay-contracts';
import type { EnvelopingRequest } from './definitions';

const relayHubInterface = RelayHub__factory.createInterface();

/**
 * Selectors of the swap claims the server relays, all of which take the
 * swap's preimage as their first argument. Two requests that claim the same
 * swap compete for it: only the first one mined can succeed.
 */
const CLAIM_SELECTORS = new Set([
  'd592e483', // Lendaswap HTLCNative redeem(bytes32,uint256,address,uint256)
  '24499b44', // Lendaswap HTLCNative redeemBySig(bytes32,uint256,address,uint256,address,address,uint256,bytes32,uint8,bytes32,bytes32)
  'c3c37fbc', // Boltz EtherSwap claim(bytes32,uint256,address,uint256)
  'cd413efa', // Boltz EtherSwap claim(bytes32,uint256,address,address,uint256)
]);

// 0x, the selector and the first argument
const CLAIM_PREFIX_LENGTH = 2 + 8 + 64;

/**
 * The keys a relay request competes on: the nonce of the smart wallet (or of
 * the factory for its owner, on a deploy), which only one transaction can
 * use, and the swap it claims, if any, which only one transaction can claim.
 */
export function getInFlightKeys({
  request,
  relayData,
}: EnvelopingRequest): string[] {
  // The client may spell the same request differently: a nonce as "1", "01"
  // or "0x01", an address with or without 0x and in any case. All of them
  // sign the same request, so they must take the same key
  const keys = [
    `nonce:${utils.getAddress(relayData.callForwarder)}:${utils.getAddress(
      request.from
    )}:${BigNumber.from(request.nonce).toString()}`.toLowerCase(),
  ];

  const data = request.data.toString().toLowerCase();
  if (
    data.length >= CLAIM_PREFIX_LENGTH &&
    CLAIM_SELECTORS.has(data.substring(2, 10))
  ) {
    keys.push(
      `claim:${utils.getAddress(request.to)}:${data.substring(
        10,
        CLAIM_PREFIX_LENGTH
      )}`.toLowerCase()
    );
  }

  return keys;
}

/**
 * The keys of the request a worker transaction relays, read from its call
 * to RelayHub.relayCall or deployCall.
 * @param data The data of the worker transaction.
 */
export function getInFlightKeysOfRelayTransaction(data: string): string[] {
  const [envelopingRequest] = relayHubInterface.parseTransaction({ data })
    .args as unknown as [EnvelopingRequest];

  return getInFlightKeys(envelopingRequest);
}

export type InFlightRelay = {
  keys: string[];
  // The nonce of the worker transaction, once it is broadcast
  nonce?: number;
};

/**
 * The relay requests the server is validating or has broadcast and not yet
 * seen mined. Every copy of a request passes validation until the first one
 * is mined, and every copy after the first reverts at the worker's cost, so
 * a request is refused while another one with a key in common is in flight.
 */
export class InFlightRelays {
  private readonly _relays = new Map<string, InFlightRelay>();

  /**
   * Takes the keys of a request, or throws if a request in flight holds any
   * of them. It is synchronous, so two concurrent requests cannot both pass.
   */
  acquire(keys: string[]): InFlightRelay {
    const busy = keys.find((key) => this._relays.has(key));
    if (busy) {
      throw new Error(
        `Another request for the same ${
          busy.startsWith('claim:') ? 'swap' : 'smart wallet nonce'
        } is already being relayed; retry once it is mined`
      );
    }
    const relay: InFlightRelay = { keys };
    keys.forEach((key) => this._relays.set(key, relay));

    return relay;
  }

  /**
   * Holds the keys of a relay already broadcast, such as one the store kept
   * from before a restart, until its worker transaction is mined. When two
   * share a key, the key stays with the later worker nonce.
   */
  restore(keys: string[], nonce: number): void {
    const relay: InFlightRelay = { keys, nonce };
    keys.forEach((key) => {
      const holder = this._relays.get(key);
      if (holder?.nonce === undefined || holder.nonce < nonce) {
        this._relays.set(key, relay);
      }
    });
  }

  release(relay: InFlightRelay): void {
    relay.keys.forEach((key) => {
      if (this._relays.get(key) === relay) {
        this._relays.delete(key);
      }
    });
  }

  /**
   * Releases the requests whose worker transaction is mined, given the
   * worker's mined nonce (the count of its mined transactions).
   */
  releaseMined(minedNonce: number): void {
    this._getBroadcast()
      .filter(({ nonce }) => nonce !== undefined && nonce < minedNonce)
      .forEach((relay) => this.release(relay));
  }

  hasBroadcast(): boolean {
    return this._getBroadcast().length > 0;
  }

  private _getBroadcast(): InFlightRelay[] {
    return [...new Set(this._relays.values())].filter(
      ({ nonce }) => nonce !== undefined
    );
  }
}
