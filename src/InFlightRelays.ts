import { BigNumber, utils } from 'ethers';
import type { EnvelopingRequest } from './definitions';
import { relayHubInterface } from './Utils';

/**
 * Selectors of the swap claims the trusted verifiers accept, all of which take
 * the swap's preimage as their first argument. Two requests that claim the
 * same swap compete for it, whichever contract they go through: only the
 * first one mined can succeed.
 */
const CLAIM_SELECTORS = new Set([
  'd592e483', // Lendaswap HTLCNative redeem(bytes32,uint256,address,uint256)
  '24499b44', // Lendaswap HTLCNative redeemBySig(bytes32,uint256,address,uint256,address,address,uint256,bytes32,uint8,bytes32,bytes32)
  '81838615', // Lendaswap HTLCNativeCoordinator redeemAndExecute(bytes32,uint256,address,uint256,(address,uint256,bytes)[],address,uint256,address,uint8,bytes32,bytes32)
  'c3c37fbc', // Boltz EtherSwap claim(bytes32,uint256,address,uint256)
  'cd413efa', // Boltz EtherSwap claim(bytes32,uint256,address,address,uint256)
]);

// 0x, the selector and the first argument
const CLAIM_PREFIX_LENGTH = 2 + 8 + 64;

/**
 * The keys a relay request competes on: the nonce of the smart wallet (or of
 * the factory for its owner, on a deploy), which only one transaction can
 * use, and the swap it claims, if any, by its preimage, which only one
 * transaction can claim.
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
    keys.push(`claim:${data.substring(10, CLAIM_PREFIX_LENGTH)}`);
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

function describeKey(key: string): string {
  return key.startsWith('claim:') ? 'swap' : 'smart wallet nonce';
}

export type InFlightRelay = {
  keys: string[];
  // The nonce of the worker transaction, once it is broadcast
  nonce?: number;
};

/**
 * The relay requests the server is broadcasting or has broadcast and not yet
 * seen confirmed. Every copy of a request passes validation until the first one
 * is mined, and every copy after the first reverts at the worker's cost, so
 * a request is refused while another one with a key in common is in flight.
 */
export class InFlightRelays {
  private readonly _relays = new Map<string, InFlightRelay>();

  // How many relays have been released as confirmed
  private _confirmations = 0;

  // The keys released as confirmed while a check that started before was
  // running, by the value of _confirmations right after their release
  private readonly _confirmedAt = new Map<string, number>();

  // The checks running, by the value of _confirmations when they started, and
  // how many started at it
  private readonly _checks = new Map<number, number>();

  /**
   * Starts the checks of a request, and returns what acquire needs to know
   * whether they are stale. Each call needs an endCheck once the request is
   * relayed or refused.
   */
  startCheck(): number {
    const check = this._confirmations;
    this._checks.set(check, (this._checks.get(check) ?? 0) + 1);

    return check;
  }

  endCheck(check: number): void {
    const running = (this._checks.get(check) ?? 0) - 1;
    if (running > 0) {
      this._checks.set(check, running);
    } else {
      this._checks.delete(check);
    }
    // a confirmation only makes stale the checks that started before it
    const oldest = Math.min(...this._checks.keys());
    this._confirmedAt.forEach((confirmedAt, key) => {
      if (confirmedAt <= oldest) {
        this._confirmedAt.delete(key);
      }
    });
  }

  /**
   * Takes the keys of a request, or throws if a request in flight holds any
   * of them. It is synchronous, so two concurrent requests cannot both pass.
   * It also throws if a request with any of the keys was confirmed after the
   * checks of this one started: they ran against the chain from before, so
   * they passed although the nonce or the swap is now used.
   * @param keys The keys of the request.
   * @param check What startCheck returned when its checks started.
   */
  acquire(keys: string[], check: number): InFlightRelay {
    const busy = keys.find((key) => this._relays.has(key));
    if (busy) {
      throw new Error(
        `Another request for the same ${describeKey(
          busy
        )} is already being relayed; retry once it is mined`
      );
    }
    const confirmed = keys.find(
      (key) => (this._confirmedAt.get(key) ?? check) > check
    );
    if (confirmed) {
      throw new Error(
        `Another request for the same ${describeKey(
          confirmed
        )} was mined while this one was checked`
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
   * Releases the requests whose worker transaction is confirmed, given the
   * count of the worker's confirmed transactions.
   */
  releaseConfirmed(confirmedCount: number): void {
    this._getBroadcast()
      .filter(({ nonce }) => nonce !== undefined && nonce < confirmedCount)
      .forEach((relay) => {
        this.release(relay);
        this._confirmations++;
        // only the checks running now can be stale because of it
        if (this._checks.size) {
          relay.keys.forEach((key) =>
            this._confirmedAt.set(key, this._confirmations)
          );
        }
      });
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
