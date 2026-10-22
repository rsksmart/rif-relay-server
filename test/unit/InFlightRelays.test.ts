import { expect } from 'chai';
import { Wallet, constants, utils } from 'ethers';
import { RelayHub__factory } from '@rsksmart/rif-relay-contracts';
import {
  InFlightRelays,
  getInFlightKeys,
  getInFlightKeysOfRelayTransaction,
} from '../../src/InFlightRelays';
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

// Takes the keys of a request whose checks have just started
function acquire(inFlightRelays: InFlightRelays, keys: string[]) {
  return inFlightRelays.acquire(keys, inFlightRelays.startCheck());
}

// The worker transaction that relays a request: a call to RelayHub
function encodeRelayTransaction(
  { request, relayData }: EnvelopingRequest,
  method: 'relayCall' | 'deployCall' = 'relayCall'
): string {
  const { from, nonce, to, data } = request;
  const common = {
    relayHub: constants.AddressZero,
    from,
    to,
    tokenContract: constants.AddressZero,
    value: 0,
    nonce,
    tokenAmount: 0,
    tokenGas: 0,
    validUntilTime: 0,
    data,
  };

  const relayHub: utils.Interface = RelayHub__factory.createInterface();

  return relayHub.encodeFunctionData(method, [
    {
      request:
        method === 'relayCall'
          ? { ...common, gas: 0 }
          : { ...common, recoverer: constants.AddressZero, index: 0 },
      relayData: {
        gasPrice: 0,
        feesReceiver: constants.AddressZero,
        callForwarder: relayData.callForwarder,
        callVerifier: constants.AddressZero,
      },
    },
    '0x',
  ]);
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
      expect(keys[1]).to.equal(`claim:${PREIMAGE.substring(2)}`.toLowerCase());
    });

    it('should give two claims of the same swap the same claim key', function () {
      const [, first] = getInFlightKeys(createRequest());
      const [, second] = getInFlightKeys(createRequest());

      expect(first).to.equal(second);
    });

    it('should give a claim of the same swap through the coordinator the same claim key', function () {
      const coordinator = new utils.Interface([
        'function redeemAndExecute(bytes32 preimage, uint256 amount, address sender, uint256 timelock, (address target, uint256 value, bytes callData)[] calls, address sweepToken, uint256 minAmountOut, address destination, uint8 v, bytes32 r, bytes32 s)',
      ]);
      const data = coordinator.encodeFunctionData('redeemAndExecute', [
        PREIMAGE,
        1,
        Wallet.createRandom().address,
        1,
        [],
        constants.AddressZero,
        0,
        constants.AddressZero,
        27,
        constants.HashZero,
        constants.HashZero,
      ]);
      const [, direct] = getInFlightKeys(createRequest());
      const [, throughCoordinator] = getInFlightKeys(
        createRequest({ to: Wallet.createRandom().address, data })
      );

      expect(data.substring(2, 10)).to.equal('81838615');
      expect(throughCoordinator).to.equal(direct);
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

  describe('getInFlightKeysOfRelayTransaction()', function () {
    it('should read the keys of the request a relay transaction relays', function () {
      const request = createRequest();

      expect(
        getInFlightKeysOfRelayTransaction(encodeRelayTransaction(request))
      ).to.deep.equal(getInFlightKeys(request));
    });

    it('should read the keys of the request a deploy transaction relays', function () {
      const request = createRequest({ data: '0x' });

      expect(
        getInFlightKeysOfRelayTransaction(
          encodeRelayTransaction(request, 'deployCall')
        )
      ).to.deep.equal(getInFlightKeys(request));
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
      acquire(
        inFlightRelays,
        getInFlightKeys(createRequest({ callForwarder, from, data: '0x' }))
      );

      expect(() =>
        acquire(
          inFlightRelays,
          getInFlightKeys(createRequest({ callForwarder, from, data: '0x01' }))
        )
      ).to.throw('same smart wallet nonce');
    });

    it('should refuse a claim of the same swap from another smart wallet', function () {
      acquire(inFlightRelays, getInFlightKeys(createRequest()));

      expect(() =>
        acquire(inFlightRelays, getInFlightKeys(createRequest()))
      ).to.throw('same swap');
    });

    it('should accept the next nonce of the same smart wallet', function () {
      const callForwarder = Wallet.createRandom().address;
      const from = Wallet.createRandom().address;
      acquire(
        inFlightRelays,
        getInFlightKeys(
          createRequest({ callForwarder, from, nonce: 0, data: '0x' })
        )
      );

      expect(() =>
        acquire(
          inFlightRelays,
          getInFlightKeys(
            createRequest({ callForwarder, from, nonce: 1, data: '0x' })
          )
        )
      ).not.to.throw();
    });

    it('should accept the request again once released', function () {
      const keys = getInFlightKeys(createRequest());
      inFlightRelays.release(acquire(inFlightRelays, keys));

      expect(() => acquire(inFlightRelays, keys)).not.to.throw();
    });
  });

  describe('startCheck()', function () {
    let inFlightRelays: InFlightRelays;
    let keys: string[];

    beforeEach(function () {
      inFlightRelays = new InFlightRelays();
      keys = getInFlightKeys(createRequest());
    });

    it('should refuse a request checked before another with its keys was confirmed', function () {
      const check = inFlightRelays.startCheck();
      acquire(inFlightRelays, keys).nonce = 7;
      inFlightRelays.releaseMined(8);

      expect(() => inFlightRelays.acquire(keys, check)).to.throw(
        'was mined while this one was checked'
      );
    });

    it('should accept a request checked after another with its keys was confirmed', function () {
      acquire(inFlightRelays, keys).nonce = 7;
      inFlightRelays.releaseMined(8);
      const check = inFlightRelays.startCheck();

      expect(() => inFlightRelays.acquire(keys, check)).not.to.throw();
    });

    it('should accept a request checked before another with its keys failed', function () {
      const check = inFlightRelays.startCheck();
      inFlightRelays.release(acquire(inFlightRelays, keys));

      expect(() => inFlightRelays.acquire(keys, check)).not.to.throw();
    });

    it('should forget a confirmation once the checks that started before it end', function () {
      const confirmedAt = (
        inFlightRelays as unknown as { _confirmedAt: Map<string, number> }
      )._confirmedAt;
      const check = inFlightRelays.startCheck();
      const originalCheck = inFlightRelays.startCheck();
      inFlightRelays.acquire(keys, originalCheck).nonce = 7;
      inFlightRelays.endCheck(originalCheck);
      inFlightRelays.releaseMined(8);
      expect(confirmedAt.size).to.equal(keys.length);

      inFlightRelays.endCheck(check);

      expect(confirmedAt.size).to.equal(0);
    });
  });

  describe('restore()', function () {
    let inFlightRelays: InFlightRelays;

    beforeEach(function () {
      inFlightRelays = new InFlightRelays();
    });

    it('should hold a restored request until its worker transaction is mined', function () {
      const keys = getInFlightKeys(createRequest());
      inFlightRelays.restore(keys, 7);

      expect(() => acquire(inFlightRelays, keys)).to.throw();

      inFlightRelays.releaseMined(8);
      expect(() => acquire(inFlightRelays, keys)).not.to.throw();
    });

    it('should keep a key two restored requests share with the later worker nonce', function () {
      const [, claimKey = ''] = getInFlightKeys(createRequest());
      inFlightRelays.restore([claimKey], 9);
      inFlightRelays.restore([claimKey], 7);

      inFlightRelays.releaseMined(8);
      expect(() => acquire(inFlightRelays, [claimKey])).to.throw('same swap');

      inFlightRelays.releaseMined(10);
      expect(() => acquire(inFlightRelays, [claimKey])).not.to.throw();
    });
  });

  describe('releaseMined()', function () {
    let inFlightRelays: InFlightRelays;

    beforeEach(function () {
      inFlightRelays = new InFlightRelays();
    });

    it('should hold a request until its worker transaction is mined', function () {
      const keys = getInFlightKeys(createRequest());
      acquire(inFlightRelays, keys).nonce = 7;

      inFlightRelays.releaseMined(7);
      expect(() => acquire(inFlightRelays, keys)).to.throw();

      inFlightRelays.releaseMined(8);
      expect(() => acquire(inFlightRelays, keys)).not.to.throw();
    });

    it('should hold a request that is not broadcast yet', function () {
      const keys = getInFlightKeys(createRequest());
      acquire(inFlightRelays, keys);

      inFlightRelays.releaseMined(100);

      expect(inFlightRelays.hasBroadcast()).to.be.false;
      expect(() => acquire(inFlightRelays, keys)).to.throw();
    });
  });
});
