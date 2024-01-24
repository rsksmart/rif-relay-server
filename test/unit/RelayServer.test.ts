import {
  KeyManager,
  RelayServer,
  ServerDependencies,
  TxStoreManager,
} from '../../src';
import sinon, { createStubInstance } from 'sinon';
import type { EnvelopingTxRequest } from '@rsksmart/rif-relay-client';
import * as rifClient from '@rsksmart/rif-relay-client';
import { BigNumber, constants, providers } from 'ethers';
import * as utils from '../../src/Utils';
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

use(sinonChai);
use(chaiAsPromised);

describe('RelayServer tests', function () {
  const FAKE_ESTIMATION_BEFORE_FEES = 100000;
  const TOKEN_X_RATE = '0.5';
  const GAS_PRICE = 10000;
  const FAKE_FEE_AMOUNT = 10000;

  let relayServer: RelayServer;
  let provider: providers.Provider;

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

    //Set stubs
    sinon.replaceGetter(rifClient, 'estimateRelayMaxPossibleGas', () =>
      sinon.stub().resolves(BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES))
    );
    sinon.replaceGetter(rifClient, 'standardMaxPossibleGasEstimation', () =>
      sinon.stub().resolves(BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES))
    );

    provider = providers.getDefaultProvider();
    sinon.stub(utils, 'getProvider').returns(provider);

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
      sinon.stub(utils, 'getRelayHub').returns(stubRelayHub);
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
      } as unknown as EnvelopingTxRequest);
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
      } as unknown as EnvelopingTxRequest);
      expect(signedTx).to.be.eql(expectedTransactionDetails);
      expect(replenishStub).to.have.been.calledOnce;
    });
  });

  describe('Function estimateMaxPossibleGas()', function () {
    it.skip('should return only the initial estimation when there are no additional fees', async function () {
      sinon.stub(relayServerUtils, 'calculateFee').resolves(BigNumberJs(0));

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
        } as EnvelopingTxRequest
      );

      const expectedEstimation = {
        gasPrice: GAS_PRICE.toString(),
        estimation: FAKE_ESTIMATION_BEFORE_FEES.toString(),
        requiredTokenAmount: BigNumberJs(GAS_PRICE) //Using BigNumberJs here because TOKEN_X_RATE is a fraction
          .multipliedBy(FAKE_ESTIMATION_BEFORE_FEES)
          .dividedBy(TOKEN_X_RATE)
          .toString(),
        requiredNativeAmount: BigNumber.from(GAS_PRICE)
          .mul(FAKE_ESTIMATION_BEFORE_FEES)
          .toString(),
        exchangeRate: TOKEN_X_RATE,
      };

      expect(maxPossibleGasEstimation).to.deep.eq(expectedEstimation);
    });

    it('should return the initial estimation + fees when there are fees', async function () {
      sinon
        .stub(relayServerUtils, 'calculateFee')
        .resolves(BigNumberJs(FAKE_FEE_AMOUNT));

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
        } as EnvelopingTxRequest
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
      } as EnvelopingTxRequest);

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
      } as EnvelopingTxRequest);

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

      const estimatedGas = await relayServer.estimateMaxPossibleGas({
        relayRequest: {
          request: {
            tokenContract: constants.AddressZero,
          },
          relayData: {
            gasPrice: GAS_PRICE,
          },
        },
      } as EnvelopingTxRequest);

      const { maxPossibleGasWithFee } = await relayServer.getMaxPossibleGas({
        relayRequest: {
          request: {
            tokenContract: constants.AddressZero,
          },
          relayData: {
            gasPrice: GAS_PRICE,
          },
        },
      } as EnvelopingTxRequest);

      expect(estimatedGas.estimation.toString()).to.be.eq(
        maxPossibleGasWithFee.toString()
      );
    });
  });
});
