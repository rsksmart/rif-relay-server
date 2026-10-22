import {
  KeyManager,
  MAX_NODE_GAS_PRICE_FACTOR,
  RelayServer,
  ServerAction,
  ServerDependencies,
  TxStoreManager,
  KeptTransactionError,
} from '../../src';
import sinon, { SinonSpy, SinonStub, createStubInstance } from 'sinon';
import * as rifClient from '@rsksmart/rif-relay-client';
import { BigNumber, Wallet, constants, providers, utils } from 'ethers';
import * as serverUtils from '../../src/Utils';
import {
  ERC20__factory,
  ERC20,
  RelayHub,
  RelayHub__factory,
} from '@rsksmart/rif-relay-contracts';
import { expect, use } from 'chai';
import * as Conversions from '../../src/Conversions';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import chaiAsPromised from 'chai-as-promised';
import * as relayServerUtils from '../../src/relayServerUtils';
import {
  EVENT_REPLENISH_CHECK_REQUIRED,
  checkReplenish,
} from 'src/events/checkReplenish';
import * as replenish from 'src/ReplenishFunction';
import sinonChai from 'sinon-chai';
import type { HttpEnvelopingRequest } from 'src/definitions';
import { SERVER_SIGNATURE_REQUIRED } from '@rsksmart/rif-relay-client';
import { RegistrationManager } from '../../src/RegistrationManager';
import * as pastEvents from '../../src/getPastEventsForHub';
import type { TypedEvent } from '@rsksmart/rif-relay-contracts';

use(sinonChai);
use(chaiAsPromised);

describe('RelayServer tests', function () {
  const FAKE_ESTIMATION_BEFORE_FEES = 100000;
  const TOKEN_X_RATE = '0.5';
  const GAS_PRICE = 10000;
  const FAKE_FEE_AMOUNT = 10000;
  // eth_gasPrice of a Rootstock testnet node, 1.1 times the minimum gas price
  const NODE_GAS_PRICE = '6215177';

  let relayServer: RelayServer;
  let provider: providers.Provider;
  let estimateRelayMaxPossibleGas: SinonStub;
  let estimateRelayMaxPossibleGasNoSignature: SinonStub;

  beforeEach(function () {
    //Build a test server
    const managerKeyManager = createStubInstance(KeyManager);
    const workersKeyManager = createStubInstance(KeyManager);
    const txStoreManager = createStubInstance(TxStoreManager);

    relayServer = new RelayServer({
      managerKeyManager,
      txStoreManager,
      workersKeyManager,
    });

    estimateRelayMaxPossibleGas = sinon
      .stub()
      .resolves(BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES));
    estimateRelayMaxPossibleGasNoSignature = sinon
      .stub()
      .resolves(BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES));

    //Set stubs
    sinon.replaceGetter(
      rifClient,
      'estimateRelayMaxPossibleGas',
      () => estimateRelayMaxPossibleGas
    );
    sinon.replaceGetter(rifClient, 'standardMaxPossibleGasEstimation', () =>
      sinon.stub().resolves(BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES))
    );
    sinon.replaceGetter(
      rifClient,
      'estimateRelayMaxPossibleGasNoSignature',
      () => estimateRelayMaxPossibleGasNoSignature
    );

    provider = providers.getDefaultProvider();
    sinon.stub(serverUtils, 'getProvider').returns(provider);

    const token = {
      name: () => Promise.resolve('TestToken'),
      symbol: () => Promise.resolve('TT'),
      decimals: () => Promise.resolve(18),
    } as unknown as ERC20;
    sinon.stub(ERC20__factory, 'connect').returns(token);

    sinon.stub(Conversions, 'getXRateFor').resolves(TOKEN_X_RATE);
  });

  afterEach(function () {
    sinon.restore();
  });

  describe(`${EVENT_REPLENISH_CHECK_REQUIRED} event handler`, function () {
    let relayServer: RelayServer;
    const expectedTransactionDetails = {
      signedTx: '0x789zxc',
      txHash: '0x567zxc',
      nonce: 0,
    };

    beforeEach(function () {
      const stubKeyManager = {
        getAddress: () => '0x123',
      } as unknown as KeyManager;
      const serverDependencies: ServerDependencies = {
        managerKeyManager: stubKeyManager,
        workersKeyManager: stubKeyManager,
        txStoreManager: {} as unknown as TxStoreManager,
      };
      const stubRelayHub = {
        populateTransaction: {
          relayCall: () => ({}),
        },
      } as unknown as RelayHub;
      relayServer = new RelayServer(serverDependencies);
      sinon.stub(relayServer, 'isReady').returns(true);
      sinon.stub(relayServer, 'validateInputTypes').returns();
      sinon.stub(relayServer, 'validateInput').resolves();
      sinon.stub(relayServer, 'validateMaxNonce').resolves();
      sinon.stub(relayServer, 'validateRequestWithVerifier').resolves();
      sinon
        .stub(relayServerUtils, 'validateIfGasAmountIsAcceptable')
        .resolves();
      sinon.stub(relayServer, 'getMaxPossibleGas').resolves({
        maxPossibleGas: BigNumber.from(1),
        maxPossibleGasWithFee: BigNumber.from(1),
      });
      sinon
        .stub(relayServerUtils, 'validateIfTokenAmountIsAcceptable')
        .resolves();
      // sinon.stub(rifClient, 'isDeployRequest').resolves(false);
      sinon.stub(serverUtils, 'getRelayHub').returns(stubRelayHub);
      sinon
        .stub(relayServer, 'maxPossibleGasWithViewCall')
        .resolves(BigNumber.from(1));

      sinon
        .stub(relayServer.transactionManager, 'sendTransaction')
        .resolves(expectedTransactionDetails);
    });

    function createEnvelopingRequest(
      callForwarder = Wallet.createRandom().address
    ): HttpEnvelopingRequest {
      return {
        metadata: {
          relayHubAddress: '0x123abc',
          relayMaxNonce: 1,
        },
        relayRequest: {
          request: {
            from: Wallet.createRandom().address,
            nonce: '0',
            to: Wallet.createRandom().address,
            data: '0x',
          },
          relayData: {
            gasPrice: GAS_PRICE,
            callForwarder,
          },
        },
      } as unknown as HttpEnvelopingRequest;
    }

    afterEach(function () {
      sinon.restore();
    });

    it(`should register ${EVENT_REPLENISH_CHECK_REQUIRED} event handler`, function () {
      const stubKeyManager = {
        getAddress: () => '0x123',
      } as unknown as KeyManager;
      const serverDependencies: ServerDependencies = {
        managerKeyManager: stubKeyManager,
        workersKeyManager: stubKeyManager,
        txStoreManager: {} as unknown as TxStoreManager,
      };
      const relayServer = new RelayServer(serverDependencies);
      expect(relayServer).not.to.be.undefined;
      expect(
        relayServer.listeners(EVENT_REPLENISH_CHECK_REQUIRED).toString()
      ).to.be.eq(checkReplenish.toString());
    });

    it(`should emit a ${EVENT_REPLENISH_CHECK_REQUIRED} event after relaying a transaction`, async function () {
      sinon.stub(replenish, 'replenishStrategy').resolves([]);
      const expectedBlockNumber = 1;
      sinon.stub(provider, 'getBlockNumber').resolves(expectedBlockNumber);
      const onSpy = sinon.spy(relayServer, 'emit');
      const signedTx = await relayServer.createRelayTransaction(
        createEnvelopingRequest()
      );
      expect(onSpy).to.have.been.calledWith(
        EVENT_REPLENISH_CHECK_REQUIRED,
        relayServer,
        0,
        expectedBlockNumber
      );
      expect(signedTx).not.to.be.instanceOf(Error);
    });

    it(`should call the replenish function when the ${EVENT_REPLENISH_CHECK_REQUIRED} is emitted`, function () {
      const replenishStub = sinon
        .stub(replenish, 'replenishStrategy')
        .resolves([]);
      const expectedWorkerIndex = 1;
      const expectedBlockNumber = 2;
      relayServer.emit(
        EVENT_REPLENISH_CHECK_REQUIRED,
        relayServer,
        expectedWorkerIndex,
        expectedBlockNumber
      );
      expect(replenishStub).to.have.been.calledWith(
        relayServer,
        expectedWorkerIndex,
        expectedBlockNumber
      );
    });

    it(`should not raise an exception when calling createRelayTransaction if the replenish function fails`, async function () {
      const replenishStub = sinon
        .stub(replenish, 'replenishStrategy')
        .rejects(new Error('Replenish failed'));
      sinon.stub(provider, 'getBlockNumber').resolves(1);
      const signedTx = await relayServer.createRelayTransaction(
        createEnvelopingRequest()
      );
      expect(signedTx).to.be.eql(expectedTransactionDetails);
      expect(replenishStub).to.have.been.calledOnce;
    });
  });

  describe('Function createRelayTransaction() with requests in flight', function () {
    let relayServer: RelayServer;
    let sendTransaction: SinonStub;
    let signedTx: string;

    function createEnvelopingRequest(): HttpEnvelopingRequest {
      return {
        metadata: { relayHubAddress: '0x123abc', relayMaxNonce: 1 },
        relayRequest: {
          request: {
            from: Wallet.createRandom().address,
            nonce: '0',
            to: Wallet.createRandom().address,
            data: '0x',
          },
          relayData: {
            gasPrice: GAS_PRICE,
            callForwarder: Wallet.createRandom().address,
          },
        },
      } as unknown as HttpEnvelopingRequest;
    }

    beforeEach(async function () {
      const stubKeyManager = {
        getAddress: () => '0x123',
      } as unknown as KeyManager;
      relayServer = new RelayServer({
        managerKeyManager: stubKeyManager,
        workersKeyManager: stubKeyManager,
        txStoreManager: {} as unknown as TxStoreManager,
      });
      sinon.stub(relayServer, 'isReady').returns(true);
      sinon.stub(relayServer, 'validateInputTypes').returns();
      sinon.stub(relayServer, 'validateInput').resolves();
      sinon.stub(relayServer, 'validateMaxNonce').resolves();
      sinon.stub(relayServer, 'validateRequestWithVerifier').resolves();
      sinon
        .stub(relayServerUtils, 'validateIfGasAmountIsAcceptable')
        .resolves();
      sinon.stub(relayServer, 'getMaxPossibleGas').resolves({
        maxPossibleGas: BigNumber.from(1),
        maxPossibleGasWithFee: BigNumber.from(1),
      });
      sinon
        .stub(relayServerUtils, 'validateIfTokenAmountIsAcceptable')
        .resolves();
      sinon.stub(serverUtils, 'getRelayHub').returns({
        populateTransaction: { relayCall: () => ({}) },
      } as unknown as RelayHub);
      sinon
        .stub(relayServer, 'maxPossibleGasWithViewCall')
        .resolves(BigNumber.from(1));
      sinon.stub(provider, 'getBlockNumber').resolves(1);
      sinon.stub(replenish, 'replenishStrategy').resolves([]);

      signedTx = await Wallet.createRandom().signTransaction({
        nonce: 7,
        gasLimit: 21000,
        gasPrice: 1,
        chainId: 31,
      });
      sendTransaction = sinon
        .stub(relayServer.transactionManager, 'sendTransaction')
        .resolves({ txHash: utils.keccak256(signedTx), signedTx, nonce: 7 });
    });

    it('should refuse a concurrent copy of a request', async function () {
      const request = createEnvelopingRequest();

      const first = relayServer.createRelayTransaction(request);
      await expect(
        relayServer.createRelayTransaction(request)
      ).to.be.rejectedWith('already being relayed');
      await expect(first).to.be.fulfilled;
      expect(sendTransaction).to.have.been.calledOnce;
    });

    it('should refuse a copy of a request until its transaction is mined', async function () {
      const request = createEnvelopingRequest();
      await relayServer.createRelayTransaction(request);

      await expect(
        relayServer.createRelayTransaction(request)
      ).to.be.rejectedWith('already being relayed');

      relayServer.inFlightRelays.releaseMined(8);
      await expect(relayServer.createRelayTransaction(request)).to.be.fulfilled;
    });

    it('should hold a request whose broadcast got no answer until its transaction is mined', async function () {
      const request = createEnvelopingRequest();
      // the node may have the transaction, and the boost sends it again
      sendTransaction
        .onFirstCall()
        .rejects(new KeptTransactionError(7, new Error('timeout')));

      await expect(
        relayServer.createRelayTransaction(request)
      ).to.be.rejectedWith('timeout');
      await expect(
        relayServer.createRelayTransaction(request)
      ).to.be.rejectedWith('already being relayed');

      relayServer.inFlightRelays.releaseMined(8);
      await expect(relayServer.createRelayTransaction(request)).to.be.fulfilled;
    });

    it('should hold the requests of the relay transactions stored before a restart', async function () {
      const request = createEnvelopingRequest();
      const {
        relayRequest: {
          request: { from, nonce, to, data },
          relayData: { callForwarder },
        },
      } = request;
      const relayCall = RelayHub__factory.createInterface().encodeFunctionData(
        'relayCall',
        [
          {
            request: {
              relayHub: constants.AddressZero,
              from,
              to,
              tokenContract: constants.AddressZero,
              value: 0,
              gas: 0,
              nonce,
              tokenAmount: 0,
              tokenGas: 0,
              validUntilTime: 0,
              data,
            },
            relayData: {
              gasPrice: 0,
              feesReceiver: constants.AddressZero,
              callForwarder,
              callVerifier: constants.AddressZero,
            },
          },
          '0x',
        ] as never
      );
      relayServer.txStoreManager = {
        getAllBySigner: sinon.stub().resolves([
          {
            txId: '0x01',
            serverAction: ServerAction.RELAY_CALL,
            data: relayCall,
            nonce: 7,
          },
          // not a relay, so it holds nothing
          { txId: '0x02', serverAction: ServerAction.VALUE_TRANSFER, nonce: 8 },
          // unreadable, so it is skipped
          {
            txId: '0x03',
            serverAction: ServerAction.RELAY_CALL,
            data: '0xdeadbeef',
            nonce: 9,
          },
        ]),
      } as unknown as TxStoreManager;

      await relayServer._restoreInFlightRelays();

      await expect(
        relayServer.createRelayTransaction(request)
      ).to.be.rejectedWith('already being relayed');
      relayServer.inFlightRelays.releaseMined(8);
      await expect(relayServer.createRelayTransaction(request)).to.be.fulfilled;
    });

    it('should not hold the keys of a request while it is checked', async function () {
      const request = createEnvelopingRequest();
      // the first copy is still being checked, e.g. a forged one
      let failFirstCheck: (error: Error) => void = () => undefined;
      (relayServer.validateRequestWithVerifier as SinonStub)
        .onFirstCall()
        .returns(
          new Promise((_resolve, reject) => {
            failFirstCheck = reject;
          })
        );

      const first = relayServer.createRelayTransaction(request);
      await expect(relayServer.createRelayTransaction(request)).to.be.fulfilled;

      failFirstCheck(new Error('invalid signature'));
      await expect(first).to.be.rejectedWith('invalid signature');
      expect(sendTransaction).to.have.been.calledOnce;
    });

    it('should hold a request whose transaction was kept with another hash until it is mined', async function () {
      const request = createEnvelopingRequest();
      sendTransaction
        .onFirstCall()
        .rejects(new KeptTransactionError(7, new Error('txhash mismatch')));

      await expect(
        relayServer.createRelayTransaction(request)
      ).to.be.rejectedWith('txhash mismatch');
      await expect(
        relayServer.createRelayTransaction(request)
      ).to.be.rejectedWith('already being relayed');
    });

    it('should accept a copy of a request that failed', async function () {
      const request = createEnvelopingRequest();
      sendTransaction.onFirstCall().rejects(new Error('node refused it'));

      await expect(
        relayServer.createRelayTransaction(request)
      ).to.be.rejectedWith('node refused it');
      await expect(relayServer.createRelayTransaction(request)).to.be.fulfilled;
    });

    it('should dry run and broadcast with estimateGasFactor on top of the estimate', async function () {
      (relayServer.getMaxPossibleGas as SinonStub).resolves({
        maxPossibleGas: BigNumber.from(100000),
        maxPossibleGasWithFee: BigNumber.from(100000),
      });

      await relayServer.createRelayTransaction(createEnvelopingRequest());

      const expected = BigNumber.from(100000)
        .mul(relayServer.config.blockchain.estimateGasFactor * 10)
        .div(10);
      expect(
        (relayServer.maxPossibleGasWithViewCall as SinonStub).firstCall.args[2]
      ).to.eql(expected);
    });

    function stubMinedNonces(read: number, write: number) {
      // getProvider already returns the shared provider of these tests
      const readCount = sinon
        .stub(provider, 'getTransactionCount')
        .resolves(read);
      const writeCount = sinon.stub().resolves(write);
      sinon.stub(serverUtils, 'getWriteProvider').returns({
        getTransactionCount: writeCount,
      } as unknown as providers.Provider);

      return { readCount, writeCount };
    }

    it('should release the requests whose transaction both nodes have mined on each block', async function () {
      await relayServer.createRelayTransaction(createEnvelopingRequest());
      const { readCount, writeCount } = stubMinedNonces(8, 8);

      await relayServer._releaseMinedRelays(1);

      expect(readCount).to.have.been.calledWith('0x123', 'latest');
      expect(writeCount).to.have.been.calledWith('0x123', 'latest');
      expect(relayServer.inFlightRelays.hasBroadcast()).to.be.false;
    });

    it('should hold a request while the read node has not seen its transaction mined', async function () {
      await relayServer.createRelayTransaction(createEnvelopingRequest());
      stubMinedNonces(7, 8);

      await relayServer._releaseMinedRelays(1);

      expect(relayServer.inFlightRelays.hasBroadcast()).to.be.true;
    });

    it('should keep the requests held and go on when a node cannot be read', async function () {
      await relayServer.createRelayTransaction(createEnvelopingRequest());
      sinon.stub(provider, 'getTransactionCount').resolves(8);
      sinon.stub(serverUtils, 'getWriteProvider').returns({
        getTransactionCount: sinon.stub().rejects(new Error('node is down')),
      } as unknown as providers.Provider);

      await expect(relayServer._releaseMinedRelays(1)).to.be.fulfilled;

      expect(relayServer.inFlightRelays.hasBroadcast()).to.be.true;
    });

    it('should read the mined nonces once per block', async function () {
      await relayServer.createRelayTransaction(createEnvelopingRequest());
      const { readCount } = stubMinedNonces(7, 7);

      await relayServer._releaseMinedRelays(1);
      await relayServer._releaseMinedRelays(1);
      expect(readCount).to.have.been.calledOnce;

      await relayServer._releaseMinedRelays(2);
      expect(readCount).to.have.been.calledTwice;
    });

    it('should hold a request while the write node has not seen its transaction mined', async function () {
      await relayServer.createRelayTransaction(createEnvelopingRequest());
      stubMinedNonces(8, 7);

      await relayServer._releaseMinedRelays(1);

      expect(relayServer.inFlightRelays.hasBroadcast()).to.be.true;
    });
  });

  describe('Function maxPossibleGasWithViewCall()', function () {
    const GAS_LIMIT = 100000;
    let transactionResult: string;

    function createEnvelopingRequest(isDeploy = false): HttpEnvelopingRequest {
      return {
        metadata: { relayHubAddress: '0x123abc', relayMaxNonce: 1 },
        relayRequest: {
          request: isDeploy ? { index: '0' } : {},
          relayData: { gasPrice: GAS_PRICE },
        },
      } as unknown as HttpEnvelopingRequest;
    }

    beforeEach(function () {
      // the client's dry run is an eth_call through the provider it is given
      rifClient.setProvider(provider);
      sinon
        .stub(provider, 'call')
        .callsFake(() => Promise.resolve(transactionResult));
    });

    it('should return the gas limit of a relay call that succeeds', async function () {
      transactionResult =
        RelayHub__factory.createInterface().encodeFunctionResult('relayCall', [
          true,
        ]);

      await expect(
        relayServer.maxPossibleGasWithViewCall(
          {},
          createEnvelopingRequest(),
          BigNumber.from(GAS_LIMIT)
        )
      ).to.eventually.eql(BigNumber.from(GAS_LIMIT));
    });

    it('should reject a relay call that returns no data with every gas limit', async function () {
      transactionResult = '0x';

      await expect(
        relayServer.maxPossibleGasWithViewCall(
          {},
          createEnvelopingRequest(),
          BigNumber.from(GAS_LIMIT)
        )
      ).to.be.rejectedWith('returned no result in the dry run');
      // the first limit and four larger ones
      expect((provider.call as SinonStub).callCount).to.equal(5);
    });

    it('should retry with more gas a relay call that runs out of gas', async function () {
      const success = RelayHub__factory.createInterface().encodeFunctionResult(
        'relayCall',
        [true]
      );
      // on Rootstock an eth_call that runs out of gas returns no data
      (provider.call as SinonStub).callsFake(
        (transaction: { gasLimit: BigNumber }) =>
          Promise.resolve(
            BigNumber.from(transaction.gasLimit).gte(GAS_LIMIT * 1.25)
              ? success
              : '0x'
          )
      );

      await expect(
        relayServer.maxPossibleGasWithViewCall(
          {},
          createEnvelopingRequest(),
          BigNumber.from(GAS_LIMIT)
        )
      ).to.eventually.eql(BigNumber.from(GAS_LIMIT * 1.25));
    });

    it('should reject a relay call whose destination call fails', async function () {
      transactionResult =
        RelayHub__factory.createInterface().encodeFunctionResult('relayCall', [
          false,
        ]);

      await expect(
        relayServer.maxPossibleGasWithViewCall(
          {},
          createEnvelopingRequest(),
          BigNumber.from(GAS_LIMIT)
        )
      ).to.be.rejectedWith('The destination call fails in the dry run');
    });

    it('should accept a deploy call, which returns no data', async function () {
      transactionResult = '0x';

      await expect(
        relayServer.maxPossibleGasWithViewCall(
          {},
          createEnvelopingRequest(true),
          BigNumber.from(GAS_LIMIT)
        )
      ).to.eventually.eql(BigNumber.from(GAS_LIMIT));
    });
  });

  describe('Function estimateMaxPossibleGas()', function () {
    it('should return only the initial estimation when there are no additional fees(empty signature)', async function () {
      sinon.stub(relayServerUtils, 'calculateFee').resolves(BigNumberJs(0));
      sinon.stub(relayServer, 'validateInputTypes').returns();

      const maxPossibleGasEstimation = await relayServer.estimateMaxPossibleGas(
        {
          relayRequest: {
            request: {
              tokenContract: constants.AddressZero,
            },
            relayData: {
              gasPrice: GAS_PRICE,
            },
          },
          metadata: {
            signature: '',
          },
        } as HttpEnvelopingRequest
      );

      expect(maxPossibleGasEstimation.estimation).to.be.equal(
        FAKE_ESTIMATION_BEFORE_FEES.toString()
      );
      expect(estimateRelayMaxPossibleGasNoSignature).to.be.called;
    });

    it('should return only the initial estimation when there are no additional fees(no signature)', async function () {
      sinon.stub(relayServerUtils, 'calculateFee').resolves(BigNumberJs(0));
      sinon.stub(relayServer, 'validateInputTypes').returns();

      const maxPossibleGasEstimation = await relayServer.estimateMaxPossibleGas(
        {
          relayRequest: {
            request: {
              tokenContract: constants.AddressZero,
            },
            relayData: {
              gasPrice: GAS_PRICE,
            },
          },
          metadata: {
            signature: SERVER_SIGNATURE_REQUIRED,
          },
        } as HttpEnvelopingRequest
      );

      expect(maxPossibleGasEstimation.estimation).to.be.equal(
        FAKE_ESTIMATION_BEFORE_FEES.toString()
      );
      expect(estimateRelayMaxPossibleGasNoSignature).to.be.called;
    });

    it('should return only the initial estimation when there are no additional fees', async function () {
      sinon.stub(relayServerUtils, 'calculateFee').resolves(BigNumberJs(0));
      sinon.stub(relayServer, 'validateInputTypes').returns();

      const maxPossibleGasEstimation = await relayServer.estimateMaxPossibleGas(
        {
          relayRequest: {
            request: {
              tokenContract: constants.AddressZero,
            },
            relayData: {
              gasPrice: GAS_PRICE,
            },
          },
          metadata: {},
        } as HttpEnvelopingRequest
      );

      expect(maxPossibleGasEstimation.estimation).to.be.equal(
        FAKE_ESTIMATION_BEFORE_FEES.toString()
      );
      expect(estimateRelayMaxPossibleGas).to.be.called;
    });

    it('should return the initial estimation + fees when there are fees', async function () {
      sinon
        .stub(relayServerUtils, 'calculateFee')
        .resolves(BigNumberJs(FAKE_FEE_AMOUNT));
      sinon.stub(relayServer, 'validateInputTypes').returns();

      const maxPossibleGasEstimation = await relayServer.estimateMaxPossibleGas(
        {
          relayRequest: {
            request: {
              tokenContract: constants.AddressZero,
            },
            relayData: {
              gasPrice: GAS_PRICE,
            },
          },
          metadata: {},
        } as HttpEnvelopingRequest
      );

      expect(maxPossibleGasEstimation.estimation).to.eq(
        BigNumberJs(FAKE_ESTIMATION_BEFORE_FEES)
          .plus(FAKE_FEE_AMOUNT)
          .toString()
      );
    });
  });

  describe('Function getMaxPossibleGas()', function () {
    beforeEach(function () {
      sinon
        .stub(relayServerUtils, 'validateIfGasAmountIsAcceptable')
        .resolves();
    });

    it('should return only the initial estimation when there are no fees configured', async function () {
      sinon.stub(relayServerUtils, 'calculateFee').resolves(BigNumberJs(0));

      const { maxPossibleGasWithFee } = await relayServer.getMaxPossibleGas({
        relayRequest: {
          request: {
            tokenContract: constants.AddressZero,
          },
          relayData: {
            gasPrice: GAS_PRICE,
          },
        },
      } as HttpEnvelopingRequest);

      expect(maxPossibleGasWithFee.toString()).to.be.equal(
        FAKE_ESTIMATION_BEFORE_FEES.toString()
      );
    });

    it('should return the initial estimation + fees when there are fees', async function () {
      sinon
        .stub(relayServerUtils, 'calculateFee')
        .resolves(BigNumberJs(FAKE_FEE_AMOUNT));

      const { maxPossibleGasWithFee } = await relayServer.getMaxPossibleGas({
        relayRequest: {
          request: {
            tokenContract: constants.AddressZero,
          },
          relayData: {
            gasPrice: GAS_PRICE,
          },
        },
      } as HttpEnvelopingRequest);

      expect(maxPossibleGasWithFee.toString()).to.eq(
        BigNumberJs(FAKE_ESTIMATION_BEFORE_FEES)
          .plus(FAKE_FEE_AMOUNT)
          .toString()
      );
    });
  });

  describe('Comparisons between estimateMaxPossibleGas() and getMaxPossibleGas()', function () {
    //Technically the estimation can be slightly greater but here we are using stubs so they should be equal
    it('Value obtained from estimation should be equal to value required on execution', async function () {
      sinon
        .stub(relayServerUtils, 'calculateFee')
        .resolves(BigNumberJs(FAKE_FEE_AMOUNT));

      sinon.stub(relayServer, 'validateInputTypes').returns();

      const estimatedGas = await relayServer.estimateMaxPossibleGas({
        relayRequest: {
          request: {
            tokenContract: constants.AddressZero,
          },
          relayData: {
            gasPrice: GAS_PRICE,
          },
        },
        metadata: {},
      } as HttpEnvelopingRequest);

      const { maxPossibleGasWithFee } = await relayServer.getMaxPossibleGas({
        relayRequest: {
          request: {
            tokenContract: constants.AddressZero,
          },
          relayData: {
            gasPrice: GAS_PRICE,
          },
        },
        metadata: {},
      } as HttpEnvelopingRequest);

      expect(estimatedGas.estimation.toString()).to.be.eq(
        maxPossibleGasWithFee.toString()
      );
    });
  });

  describe('Function tokenHandler()', function () {
    let queryVerifiersSpy: SinonSpy;
    let callVerifierMehodStub: SinonStub;
    let trustedVerifiers: Set<string>;
    const verifier = '0x145845fd06c85B7EA1AA2d030E1a747B3d8d15D7';
    const addressArray = ['0x145845fd06c85B7EA1AA2d030E1a747B3d8d15D7'];

    beforeEach(function () {
      queryVerifiersSpy = sinon.spy(relayServerUtils, 'queryVerifiers');
      callVerifierMehodStub = sinon.stub(
        relayServerUtils,
        'getAcceptedTokensFromVerifier'
      );
      callVerifierMehodStub.returns(addressArray);
      trustedVerifiers = new Set<string>();
      trustedVerifiers.add(verifier.toLowerCase());
      trustedVerifiers.add(
        '0x155845fd06c85B7EA1AA2d030E1a747B3d8d15D7'.toLowerCase()
      );
      sinon.replace(relayServer, 'trustedVerifiers', trustedVerifiers);
    });

    it('should throw error if verifier is not trusted', async function () {
      const untrustedVerifier = '0x165845fd06c85B7EA1AA2d030E1a747B3d8d15D7';

      await expect(
        relayServer.tokenHandler(untrustedVerifier)
      ).to.be.rejectedWith('Supplied verifier is not trusted');
    });

    it('should return tokens from all trusted verifiers', async function () {
      const expectedResult = Array.from(trustedVerifiers).reduce(
        (a, v) => ({ ...a, [utils.getAddress(v)]: addressArray }),
        {}
      );
      const result = await relayServer.tokenHandler();

      expect(result).to.be.deep.equal(expectedResult);
      expect(queryVerifiersSpy).to.be.calledOnce;
      for (const v of trustedVerifiers) {
        expect(callVerifierMehodStub).to.be.calledWithExactly(v);
      }
    });

    it('should return token from provided verifier', async function () {
      const expectedResult = {
        [utils.getAddress(verifier)]: addressArray,
      };
      const result = await relayServer.tokenHandler(verifier);

      expect(result).to.be.deep.equal(expectedResult);
      expect(queryVerifiersSpy).to.be.calledOnce;
      expect(callVerifierMehodStub).to.be.calledWithExactly(verifier);
    });
  });

  describe('Function destinationContractHandler()', function () {
    let queryVerifiersSpy: SinonSpy;
    let callVerifierMehodStub: SinonStub;
    let trustedVerifiers: Set<string>;
    const verifier = '0x145845fd06c85B7EA1AA2d030E1a747B3d8d15D7';
    const addressArray = ['0x145845fd06c85B7EA1AA2d030E1a747B3d8d15D7'];

    beforeEach(function () {
      queryVerifiersSpy = sinon.spy(relayServerUtils, 'queryVerifiers');
      callVerifierMehodStub = sinon.stub(
        relayServerUtils,
        'getAcceptedContractsFromVerifier'
      );
      callVerifierMehodStub.returns(addressArray);
      trustedVerifiers = new Set<string>();
      trustedVerifiers.add(verifier.toLowerCase());
      trustedVerifiers.add(
        '0x155845fd06c85B7EA1AA2d030E1a747B3d8d15D7'.toLowerCase()
      );
      sinon.replace(relayServer, 'trustedVerifiers', trustedVerifiers);
    });

    it('should throw error if verifier is not trusted', async function () {
      const untrustedVerifier = '0x165845fd06c85B7EA1AA2d030E1a747B3d8d15D7';

      await expect(
        relayServer.destinationContractHandler(untrustedVerifier)
      ).to.be.rejectedWith('Supplied verifier is not trusted');
    });

    it('should return contracts from all trusted verifiers', async function () {
      const expectedResult = Array.from(trustedVerifiers).reduce(
        (a, v) => ({ ...a, [utils.getAddress(v)]: addressArray }),
        {}
      );
      const result = await relayServer.destinationContractHandler();

      expect(result).to.be.deep.equal(expectedResult);
      expect(queryVerifiersSpy).to.be.calledOnce;
      for (const v of trustedVerifiers) {
        expect(callVerifierMehodStub).to.be.calledWithExactly(v);
      }
    });

    it('should return contract from provided verifier', async function () {
      const expectedResult = {
        [utils.getAddress(verifier)]: addressArray,
      };
      const result = await relayServer.destinationContractHandler(verifier);

      expect(result).to.be.deep.equal(expectedResult);
      expect(queryVerifiersSpy).to.be.calledOnce;
      expect(callVerifierMehodStub).to.be.calledWithExactly(verifier);
    });
  });

  describe('Function intervalHandler()', function () {
    type PollingState = {
      _lastScannedBlock: number;
      _lastSuccessfulRounds: number;
      _workerSemaphoreOn: boolean;
    };
    let errorListener: SinonSpy;
    let getBlock: SinonStub;
    let worker: SinonStub;

    beforeEach(function () {
      errorListener = sinon.spy();
      relayServer.on('error', errorListener);
      getBlock = sinon.stub(provider, 'getBlock');
      worker = sinon.stub(relayServer, '_worker').resolves([]);
      (relayServer as unknown as PollingState)._lastScannedBlock = 99;
    });

    it('should settle and reset the successful rounds if the block lookup fails', async function () {
      getBlock.rejects(new Error('getBlock failed'));

      await expect(relayServer.intervalHandler()).to.be.fulfilled;

      expect(errorListener).to.be.calledOnce;
      expect(
        (relayServer as unknown as PollingState)._lastSuccessfulRounds
      ).to.be.equal(0);
      expect(worker).not.to.be.called;
    });

    it('should settle and reset the successful rounds if the worker fails', async function () {
      getBlock.resolves({ number: 100 });
      worker.rejects(new Error('getLogs failed'));

      await expect(relayServer.intervalHandler()).to.be.fulfilled;

      expect(errorListener).to.be.calledOnce;
      const state = relayServer as unknown as PollingState;
      expect(state._lastSuccessfulRounds).to.be.equal(0);
      expect(state._workerSemaphoreOn).to.be.false;
    });

    it('should retry the block in the next interval after a block lookup failure', async function () {
      getBlock.onFirstCall().rejects(new Error('getBlock failed'));
      getBlock.resolves({ number: 100 });

      await relayServer.intervalHandler();
      await relayServer.intervalHandler();

      expect(worker).to.be.calledOnceWithExactly(100);
      expect(
        (relayServer as unknown as PollingState)._lastSuccessfulRounds
      ).to.be.equal(1);
    });

    it('should retry the block in the next interval after a worker failure', async function () {
      getBlock.resolves({ number: 100 });
      worker.onFirstCall().rejects(new Error('getLogs failed'));

      await relayServer.intervalHandler();
      await relayServer.intervalHandler();

      expect(worker).to.be.calledTwice;
      expect(worker.secondCall).to.be.calledWithExactly(100);
      expect(
        (relayServer as unknown as PollingState)._lastSuccessfulRounds
      ).to.be.equal(1);
    });

    it('should time out a round whose worker outlasts the ready timeout', async function () {
      const readyTimeout = 1000;
      relayServer.config = {
        ...relayServer.config,
        app: { ...relayServer.config.app, devMode: false, readyTimeout },
      };
      const clock = sinon.useFakeTimers();
      getBlock.resolves({ number: 100 });
      worker.callsFake(
        () =>
          new Promise<string[]>((resolve) =>
            setTimeout(() => resolve([]), readyTimeout + 1)
          )
      );

      const round = relayServer.intervalHandler();
      await clock.tickAsync(readyTimeout + 1);
      await round;

      // the timeout reset the rounds while the worker was still running, then the round counted
      expect(
        (relayServer as unknown as PollingState)._lastSuccessfulRounds
      ).to.be.equal(1);
    });
  });

  describe('Function _updateLatestTxBlockNumber()', function () {
    let getPastEventsForHub: SinonStub;

    beforeEach(function () {
      relayServer.config = {
        ...relayServer.config,
        blockchain: {
          ...relayServer.config.blockchain,
          registrationBlockRate: 1000,
          initialBlockToScan: 1,
        },
      };
      getPastEventsForHub = sinon
        .stub(pastEvents, 'getPastEventsForHub')
        .resolves([]);
    });

    it('should not count the disabling of a worker as server activity', async function () {
      const relayed = {
        event: 'TransactionRelayed',
        blockNumber: 90,
      } as unknown as TypedEvent;
      const disabled = {
        event: 'RelayWorkersDisabled',
        blockNumber: 95,
      } as unknown as TypedEvent;

      await relayServer._updateLatestTxBlockNumber([relayed, disabled], 100);

      expect(relayServer.lastMinedActiveTransaction).to.be.equal(relayed);
    });

    it('should look back for the latest activity only once', async function () {
      await relayServer._updateLatestTxBlockNumber([], 100);
      await relayServer._updateLatestTxBlockNumber([], 101);

      expect(getPastEventsForHub).to.be.calledOnce;
      expect(getPastEventsForHub.firstCall.args[1]).to.deep.equal({
        fromBlock: 1,
      });
      expect(getPastEventsForHub.firstCall.args[2]).to.deep.equal([
        'RelayServerRegistered',
        'RelayWorkersAdded',
        'TransactionRelayed',
        'TransactionRelayedButRevertedByRecipient',
      ]);
    });
  });

  describe('Function validateInput()', function () {
    const WORKER_ADDRESS = '0x74105590d404df3f384a099c2e55135281ca6b40';
    // rif-relay-client default gasPrice, 0.06 gwei
    const CLIENT_DEFAULT_GAS_PRICE = 60000000;

    let relayServer: RelayServer;

    function createRequest(gasPrice: BigNumber): HttpEnvelopingRequest {
      return {
        metadata: {
          relayHubAddress: relayServer.config.contracts.relayHubAddress,
          signature: '0x1234',
          relayMaxNonce: 1,
        },
        relayRequest: {
          request: {
            validUntilTime:
              Math.round(Date.now() / 1000) +
              2 * relayServer.config.app.requestMinValidSeconds,
          },
          relayData: {
            gasPrice,
            feesReceiver: WORKER_ADDRESS,
          },
        },
      } as unknown as HttpEnvelopingRequest;
    }

    function getMaxGasPrice() {
      const { maxRequestGasPriceFactor, maxRequestGasPriceFloor } =
        relayServer.config.blockchain;

      return BigNumber.from(
        BigNumberJs.min(
          BigNumberJs.max(
            BigNumberJs(NODE_GAS_PRICE).multipliedBy(maxRequestGasPriceFactor),
            maxRequestGasPriceFloor.toString()
          ),
          BigNumberJs(NODE_GAS_PRICE).multipliedBy(MAX_NODE_GAS_PRICE_FACTOR)
        ).toFixed(0)
      );
    }

    beforeEach(function () {
      const stubKeyManager = {
        getAddress: () => WORKER_ADDRESS,
      } as unknown as KeyManager;
      relayServer = new RelayServer({
        managerKeyManager: stubKeyManager,
        workersKeyManager: stubKeyManager,
        txStoreManager: {} as unknown as TxStoreManager,
      });
      relayServer.gasPrice = BigNumber.from(NODE_GAS_PRICE);
    });

    it('should accept the node gasPrice', async function () {
      await expect(
        relayServer.validateInput(createRequest(BigNumber.from(NODE_GAS_PRICE)))
      ).to.be.fulfilled;
    });

    it('should accept the client default gasPrice', async function () {
      // about 10 times the testnet node gasPrice
      await expect(
        relayServer.validateInput(
          createRequest(BigNumber.from(CLIENT_DEFAULT_GAS_PRICE))
        )
      ).to.be.fulfilled;
    });

    it('should accept the maximum gasPrice', async function () {
      await expect(relayServer.validateInput(createRequest(getMaxGasPrice())))
        .to.be.fulfilled;
    });

    it('should keep accepting the client default gasPrice when the node gasPrice falls', async function () {
      // the factor alone would allow only half the client default
      relayServer.gasPrice = BigNumber.from(CLIENT_DEFAULT_GAS_PRICE).div(
        2 * relayServer.config.blockchain.maxRequestGasPriceFactor
      );

      await expect(
        relayServer.validateInput(
          createRequest(BigNumber.from(CLIENT_DEFAULT_GAS_PRICE))
        )
      ).to.be.fulfilled;
    });

    it('should reject the client default gasPrice when it is too close to the node gas price cap', async function () {
      // the floor allows the client default, but it is above
      // MAX_NODE_GAS_PRICE_FACTOR times this node gasPrice
      relayServer.gasPrice = BigNumber.from(CLIENT_DEFAULT_GAS_PRICE)
        .div(MAX_NODE_GAS_PRICE_FACTOR)
        .sub(1);

      await expect(
        relayServer.validateInput(
          createRequest(BigNumber.from(CLIENT_DEFAULT_GAS_PRICE))
        )
      ).to.be.rejectedWith(
        /Unacceptable gasPrice: relayServer's maximum gasPrice:/
      );
    });

    it('should reject a gasPrice lower than the node gasPrice', async function () {
      await expect(
        relayServer.validateInput(
          createRequest(BigNumber.from(NODE_GAS_PRICE).sub(1))
        )
      ).to.be.rejectedWith(/Unacceptable gasPrice: relayServer's gasPrice:/);
    });

    it('should reject a gasPrice above the maximum', async function () {
      await expect(
        relayServer.validateInput(createRequest(getMaxGasPrice().add(1)))
      ).to.be.rejectedWith(
        /Unacceptable gasPrice: relayServer's maximum gasPrice:/
      );
    });

    it('should keep the maximum below the node gas price cap', function () {
      // RSK rejects a transaction priced above 80 times the minimum gas price
      const minimumGasPrice = BigNumber.from(NODE_GAS_PRICE).mul(10).div(11);

      expect(getMaxGasPrice().lt(minimumGasPrice.mul(80))).to.be.true;
    });

    it('should reject every request until the node gasPrice is known', async function () {
      relayServer.gasPrice = constants.Zero;

      await expect(
        relayServer.validateInput(createRequest(BigNumber.from(NODE_GAS_PRICE)))
      ).to.be.rejectedWith(
        "Unacceptable gasPrice: relayServer's gasPrice is not initialized"
      );
    });
  });

  describe('Function init()', function () {
    let initFromChain: SinonStub;
    let writeProvider: providers.Provider;

    beforeEach(function () {
      (relayServer.txStoreManager.getAllBySigner as SinonStub).resolves([]);
      relayServer.config = {
        ...relayServer.config,
        blockchain: {
          ...relayServer.config.blockchain,
          startupStateSource: 'chain',
        },
      };
      sinon.stub(serverUtils, 'isContractDeployed').resolves(true);
      sinon
        .stub(provider, 'getBlock')
        .resolves({ number: 100, timestamp: 0 } as providers.Block);
      sinon.stub(provider, 'getNetwork').resolves({ chainId: 31, name: '' });
      (provider as providers.BaseProvider & { send: SinonStub }).send = sinon
        .stub()
        .resolves('31');
      writeProvider = providers.getDefaultProvider();
      sinon.stub(serverUtils, 'getWriteProvider').returns(writeProvider);
      initFromChain = sinon
        .stub(RegistrationManager.prototype, 'initFromChain')
        .resolves();
      sinon.stub(RegistrationManager.prototype, 'printNotRegisteredMessage');
    });

    it('should read the chain state at the block before the first scanned one', async function () {
      sinon
        .stub(writeProvider, 'getNetwork')
        .resolves({ chainId: 31, name: '' });

      await relayServer.init();

      expect(initFromChain).to.be.calledOnceWithExactly(99);
      expect(
        (relayServer as unknown as { _lastScannedBlock: number })
          ._lastScannedBlock
      ).to.be.equal(99);
    });

    it('should fail if the write node is on another chain', async function () {
      sinon
        .stub(writeProvider, 'getNetwork')
        .resolves({ chainId: 30, name: '' });

      await expect(relayServer.init()).to.be.rejectedWith(
        'rskNodeWriteUrl is on chain 30, but rskNodeUrl is on chain 31'
      );
    });
  });
});
