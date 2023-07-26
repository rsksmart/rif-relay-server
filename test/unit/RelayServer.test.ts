import { KeyManager, RelayServer, TxStoreManager } from '../../src';
import sinon, { createStubInstance } from 'sinon';
import type { EnvelopingTxRequest } from '@rsksmart/rif-relay-client';
import * as rifClient from '@rsksmart/rif-relay-client';
import { BigNumber, constants, providers } from 'ethers';
import * as utils from '../../src/Utils';
import { ERC20__factory, ERC20 } from '@rsksmart/rif-relay-contracts';
import { expect, use } from 'chai';
import * as Conversions from '../../src/Conversions';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import chaiAsPromised from 'chai-as-promised';
import * as relayServerUtils from '../../src/relayServerUtils';

use(chaiAsPromised);

describe('RelayServer tests', function () {
  const FAKE_ESTIMATION_BEFORE_FEES = 100000;
  const TOKEN_X_RATE = '0.5';
  const GAS_PRICE = 10000;
  const FAKE_FEE_AMOUNT = 10000;

  let relayServer: RelayServer;

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

    sinon.stub(utils, 'getProvider').returns(providers.getDefaultProvider());

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

  describe('Function estimateMaxPossibleGas()', function () {
    it('should return only the initial estimation when there are no additional fees', async function () {
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
