import { expect } from 'chai';
import { Wallet, utils } from 'ethers';
import { InFlightRelays, getInFlightKeys } from '../../src/InFlightRelays';
import type { EnvelopingRequest } from '../../src/definitions';

const HTLC = '0x18123A31261a76c74C82ED2F8346002CaA78Ab39';
const PREIMAGE = utils.hexlify(utils.randomBytes(32));

const redeem = new utils.Interface([
  'function redeem(bytes32 preimage, uint256 amount, address sender, uint256 timelock)',
  'function refund(bytes32 preimageHash, uint256 amount, address claimAddress, uint256 timelock)',
]);

function createRequest({
  callForwarder = Wallet.createRandom().address,
  from = Wallet.createRandom().address,
  nonce = '0' as string | number,
  to = HTLC,
  data = redeem.encodeFunctionData('redeem', [
    PREIMAGE,
    1,
    Wallet.createRandom().address,
    1,
  ]),
} = {}): EnvelopingRequest {
  return {
    request: { from, nonce, to, data },
    relayData: { callForwarder },
  } as unknown as EnvelopingRequest;
}

describe('InFlightRelays', function () {
  describe('getInFlightKeys()', function () {
    it('should key a request by its smart wallet nonce', function () {
      const request = createRequest({ data: '0x' });

      expect(getInFlightKeys(request)).to.have.lengthOf(1);
      expect(getInFlightKeys(request)[0]).to.match(/^nonce:/);
    });

    it('should give every encoding of the same nonce the same key', function () {
      const callForwarder = Wallet.createRandom().address;
      const from = Wallet.createRandom().address;
      const keyOf = (nonce: string) =>
        getInFlightKeys(
          createRequest({ callForwarder, from, nonce, data: '0x' })
        )[0];

      expect(keyOf('01')).to.equal(keyOf('1'));
      expect(keyOf('0x01')).to.equal(keyOf('1'));
      expect(keyOf('0x00')).to.equal(keyOf('0'));
    });

    it('should give every spelling of the same addresses the same keys', function () {
      const callForwarder = Wallet.createRandom().address;
      const from = Wallet.createRandom().address;
      const keysOf = (forwarder: string, owner: string, to: string) =>
        getInFlightKeys(
          createRequest({ callForwarder: forwarder, from: owner, to })
        );
      const expected = keysOf(callForwarder, from, HTLC);

      expect(
        keysOf(
          callForwarder.toLowerCase(),
          from.substring(2),
          HTLC.substring(2)
        )
      ).to.deep.equal(expected);
      expect(
        keysOf(
          callForwarder.substring(2),
          `0x${from.substring(2).toUpperCase()}`,
          HTLC.toLowerCase()
        )
      ).to.deep.equal(expected);
    });

    it('should key a claim by its swap too', function () {
      const keys = getInFlightKeys(createRequest());

      expect(keys).to.have.lengthOf(2);
      expect(keys[1]).to.equal(
        `claim:${HTLC}:${PREIMAGE.substring(2)}`.toLowerCase()
      );
    });

    it('should give two claims of the same swap the same claim key', function () {
      const [, first] = getInFlightKeys(createRequest());
      const [, second] = getInFlightKeys(createRequest());

      expect(first).to.equal(second);
    });

    it('should not key a call that is not a claim by its first argument', function () {
      const data = redeem.encodeFunctionData('refund', [
        PREIMAGE,
        1,
        Wallet.createRandom().address,
        1,
      ]);

      expect(getInFlightKeys(createRequest({ data }))).to.have.lengthOf(1);
    });
  });

  describe('acquire()', function () {
    let inFlightRelays: InFlightRelays;

    beforeEach(function () {
      inFlightRelays = new InFlightRelays();
    });

    it('should refuse a request with the same smart wallet nonce', function () {
      const callForwarder = Wallet.createRandom().address;
      const from = Wallet.createRandom().address;
      inFlightRelays.acquire(
        getInFlightKeys(createRequest({ callForwarder, from, data: '0x' }))
      );

      expect(() =>
        inFlightRelays.acquire(
          getInFlightKeys(createRequest({ callForwarder, from, data: '0x01' }))
        )
      ).to.throw('same smart wallet nonce');
    });

    it('should refuse a claim of the same swap from another smart wallet', function () {
      inFlightRelays.acquire(getInFlightKeys(createRequest()));

      expect(() =>
        inFlightRelays.acquire(getInFlightKeys(createRequest()))
      ).to.throw('same swap');
    });

    it('should accept the next nonce of the same smart wallet', function () {
      const callForwarder = Wallet.createRandom().address;
      const from = Wallet.createRandom().address;
      inFlightRelays.acquire(
        getInFlightKeys(
          createRequest({ callForwarder, from, nonce: 0, data: '0x' })
        )
      );

      expect(() =>
        inFlightRelays.acquire(
          getInFlightKeys(
            createRequest({ callForwarder, from, nonce: 1, data: '0x' })
          )
        )
      ).not.to.throw();
    });

    it('should accept the request again once released', function () {
      const keys = getInFlightKeys(createRequest());
      inFlightRelays.release(inFlightRelays.acquire(keys));

      expect(() => inFlightRelays.acquire(keys)).not.to.throw();
    });
  });

  describe('releaseMined()', function () {
    let inFlightRelays: InFlightRelays;

    beforeEach(function () {
      inFlightRelays = new InFlightRelays();
    });

    it('should hold a request until its worker transaction is mined', function () {
      const keys = getInFlightKeys(createRequest());
      inFlightRelays.acquire(keys).nonce = 7;

      inFlightRelays.releaseMined(7);
      expect(() => inFlightRelays.acquire(keys)).to.throw();

      inFlightRelays.releaseMined(8);
      expect(() => inFlightRelays.acquire(keys)).not.to.throw();
    });

    it('should hold a request that is not broadcast yet', function () {
      const keys = getInFlightKeys(createRequest());
      inFlightRelays.acquire(keys);

      inFlightRelays.releaseMined(100);

      expect(inFlightRelays.hasBroadcast()).to.be.false;
      expect(() => inFlightRelays.acquire(keys)).to.throw();
    });
  });
});
