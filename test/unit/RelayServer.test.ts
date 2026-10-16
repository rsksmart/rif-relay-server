import {
  KeyManager,
  RelayServer,
  ServerDependencies,
  TxStoreManager,
} from '../../src';
import sinon, { SinonSpy, SinonStub, createStubInstance } from 'sinon';
import * as rifClient from '@rsksmart/rif-relay-client';
import { BigNumber, constants, providers, utils } from 'ethers';
import * as serverUtils from '../../src/Utils';
import { ERC20__factory, ERC20, RelayHub } from '@rsksmart/rif-relay-contracts';
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
      const signedTx = await relayServer.createRelayTransaction({
        metadata: {
          relayHubAddress: '0x123abc',
          relayMaxNonce: 1,
        },
        relayRequest: {
          request: {},
          relayData: {
            gasPrice: GAS_PRICE,
          },
        },
      } as unknown as HttpEnvelopingRequest);
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
      const signedTx = await relayServer.createRelayTransaction({
        metadata: {
          relayHubAddress: '0x123abc',
          relayMaxNonce: 1,
        },
        relayRequest: {
          request: {},
          relayData: {
            gasPrice: GAS_PRICE,
          },
        },
      } as unknown as HttpEnvelopingRequest);
      expect(signedTx).to.be.eql(expectedTransactionDetails);
      expect(replenishStub).to.have.been.calledOnce;
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

  describe('Function init()', function () {
    let initFromChain: SinonStub;
    let writeProvider: providers.Provider;

    beforeEach(function () {
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
