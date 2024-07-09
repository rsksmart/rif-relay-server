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
        } as HttpEnvelopingRequest
      );

      expect(maxPossibleGasEstimation.estimation).to.be.equal(
        FAKE_ESTIMATION_BEFORE_FEES.toString()
      );
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
});
