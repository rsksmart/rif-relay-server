import { KeyManager, RelayServer, TxStoreManager } from '../../src';
import sinon, { mock, createStubInstance } from 'sinon';
import type { EnvelopingTxRequest } from '@rsksmart/rif-relay-client';
import * as rifClient from '@rsksmart/rif-relay-client';
import { BigNumber, constants, providers } from 'ethers';
import * as utils from '../../src/Utils';
import { ERC20__factory, ERC20 } from '@rsksmart/rif-relay-contracts';
import { expect } from 'chai';
import * as Conversions from '../../src/Conversions';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import { TRANSFER_HASH, TRANSFER_FROM_HASH } from '../../src/RelayServer';
import { toPrecision } from '../../src/Conversions';

describe.only('RelayServer tests', function () {
  let relayServer: RelayServer;
  const fakeEstimationBeforeFees = 100000;

  beforeEach(function () {
    const managerKeyManager = createStubInstance(KeyManager);
    const workersKeyManager = createStubInstance(KeyManager);
    const txStoreManager = createStubInstance(TxStoreManager);

    relayServer = new RelayServer({
      managerKeyManager,
      txStoreManager,
      workersKeyManager,
    });
  });

  afterEach(function () {
    sinon.restore();
  });

  describe('Function estimateMaxPossibleGas()', function () {
    const TOKEN_X_RATE = '0.5';
    const GAS_PRICE = 10000;

    let mockServer: sinon.SinonMock;

    beforeEach(function () {
      mockServer = mock(relayServer);

      sinon.replaceGetter(rifClient, 'estimateRelayMaxPossibleGas', () =>
        sinon.stub().resolves(BigNumber.from(fakeEstimationBeforeFees))
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

    it('Should not charge fees when is sponsored', async function () {
      mockServer.expects('isSponsorshipAllowed').returns(true);

      const maxPossibleGaseEstimation =
        await relayServer.estimateMaxPossibleGas({
          relayRequest: {
            request: {
              tokenContract: constants.AddressZero,
            },
            relayData: {
              gasPrice: GAS_PRICE,
            },
          },
        } as EnvelopingTxRequest);

      expect(maxPossibleGaseEstimation.estimation).to.be.eq(
        fakeEstimationBeforeFees.toString()
      );
    });

    describe('When is not sponsored', function () {
      const FAKE_GAS_FEE_PERCENTAGE = 0.1;
      const FAKE_TRANSFER_FEE_PERCENTAGE = 0.1;
      const TOKEN_AMOUNT_TO_TRANSFER = '1000000000000000000'; //18 zeros

      let dataWhenTransfer: string;
      let dataWhenTransferFrom: string;
      let expectedFeeFromTransfer: BigNumberJs;

      beforeEach(function () {
        mockServer.expects('isSponsorshipAllowed').returns(false);

        const fakeFromAddress =
          '000000000000000000000000e87286ba960fa7aaa5b376083a31d440c8cb4bc8';
        const fakeToAddress =
          '0000000000000000000000008470af7f41ee2788eaa4cfc251927877b659cdc5';
        const tokenAmountToTransferAsHex = BigNumber.from(
          TOKEN_AMOUNT_TO_TRANSFER
        )
          .toHexString()
          .substring(2) //removes 0x
          .padStart(64, '0'); //fills with 0 to the left

        dataWhenTransfer =
          '0x' + TRANSFER_HASH + fakeToAddress + tokenAmountToTransferAsHex;

        dataWhenTransferFrom =
          '0x' +
          TRANSFER_FROM_HASH +
          fakeFromAddress +
          fakeToAddress +
          tokenAmountToTransferAsHex;

        //Calculate the expected fee when a transfer/transferFrom is executed value
        const tokenFee = BigNumberJs(TOKEN_AMOUNT_TO_TRANSFER).multipliedBy(
          FAKE_TRANSFER_FEE_PERCENTAGE
        );
        const tokenFeeAsFraction = toPrecision({
          value: tokenFee,
          precision: -18,
        });
        const feeAsFractionInNative =
          tokenFeeAsFraction.multipliedBy(TOKEN_X_RATE);
        const feeInNative = toPrecision({
          value: feeAsFractionInNative,
          precision: 18,
        });
        expectedFeeFromTransfer = feeInNative.dividedBy(GAS_PRICE);
      });

      it('Should charge fees based on gas when transferFeePercentage = 0', async function () {
        const fakeServerConfigParams = {
          app: {
            feePercentage: FAKE_GAS_FEE_PERCENTAGE,
            transferFeePercentage: 0,
          },
        };

        sinon.stub(relayServer, 'config').value(fakeServerConfigParams);

        const maxPossibleGaseEstimation =
          await relayServer.estimateMaxPossibleGas({
            relayRequest: {
              request: {
                tokenContract: constants.AddressZero,
              },
              relayData: {
                gasPrice: GAS_PRICE,
              },
            },
          } as EnvelopingTxRequest);

        expect(maxPossibleGaseEstimation.estimation).to.be.eq(
          (
            fakeEstimationBeforeFees +
            fakeEstimationBeforeFees * FAKE_GAS_FEE_PERCENTAGE
          ).toString()
        );
      });

      it('Should charge fees based on gas when transferFeePercentage is not defined', async function () {
        const fakeServerConfigParams = {
          app: {
            feePercentage: FAKE_GAS_FEE_PERCENTAGE,
          },
        };

        sinon.stub(relayServer, 'config').value(fakeServerConfigParams);

        const maxPossibleGaseEstimation =
          await relayServer.estimateMaxPossibleGas({
            relayRequest: {
              request: {
                tokenContract: constants.AddressZero,
              },
              relayData: {
                gasPrice: GAS_PRICE,
              },
            },
          } as EnvelopingTxRequest);

        expect(maxPossibleGaseEstimation.estimation).to.be.eq(
          (
            fakeEstimationBeforeFees +
            fakeEstimationBeforeFees * FAKE_GAS_FEE_PERCENTAGE
          ).toString()
        );
      });

      it('Should charge fees based on transfer value, when transferFeePercentage > 0 and a transfer() is being relayed', async function () {
        const fakeServerConfigParams = {
          app: {
            feePercentage: FAKE_GAS_FEE_PERCENTAGE,
            transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
          },
        };
        sinon.stub(relayServer, 'config').value(fakeServerConfigParams);

        const maxPossibleGaseEstimation =
          await relayServer.estimateMaxPossibleGas({
            relayRequest: {
              request: {
                tokenContract: constants.AddressZero,
                data: dataWhenTransfer,
              },
              relayData: {
                gasPrice: GAS_PRICE,
              },
            },
          } as EnvelopingTxRequest);

        expect(maxPossibleGaseEstimation.estimation).to.be.eq(
          BigNumberJs(fakeEstimationBeforeFees)
            .plus(expectedFeeFromTransfer)
            .toString()
        );
      });

      it('Should charge fees based on transfer value, when transferFeePercentage > 0 and a transferFrom() is being relayed', async function () {
        const fakeServerConfigParams = {
          app: {
            feePercentage: FAKE_GAS_FEE_PERCENTAGE,
            transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
          },
        };
        sinon.stub(relayServer, 'config').value(fakeServerConfigParams);

        const maxPossibleGaseEstimation =
          await relayServer.estimateMaxPossibleGas({
            relayRequest: {
              request: {
                tokenContract: constants.AddressZero,
                data: dataWhenTransferFrom,
              },
              relayData: {
                gasPrice: GAS_PRICE,
              },
            },
          } as EnvelopingTxRequest);

        expect(maxPossibleGaseEstimation.estimation).to.be.eq(
          BigNumberJs(fakeEstimationBeforeFees)
            .plus(expectedFeeFromTransfer)
            .toString()
        );
      });
    });
  });

  describe('Function getMaxPossibleGas()', function () {
    const TOKEN_X_RATE = '0.5';
    const GAS_PRICE = 10000;

    let mockServer: sinon.SinonMock;

    beforeEach(function () {
      mockServer = mock(relayServer);

      sinon.replaceGetter(rifClient, 'standardMaxPossibleGasEstimation', () =>
        sinon.stub().resolves(BigNumber.from(fakeEstimationBeforeFees))
      );
      sinon.stub(utils, 'getProvider').returns(providers.getDefaultProvider());

      mockServer.expects('_validateIfGasAmountIsAceptable').resolves();

      const token = {
        name: () => Promise.resolve('TestToken'),
        symbol: () => Promise.resolve('TT'),
        decimals: () => Promise.resolve(18),
      } as unknown as ERC20;
      sinon.stub(ERC20__factory, 'connect').returns(token);

      sinon.stub(Conversions, 'getXRateFor').resolves(TOKEN_X_RATE);
    });

    it('Should not charge fees when is sponsored', async function () {
      mockServer.expects('isSponsorshipAllowed').returns(true);

      const maxPossibleGas = await relayServer.getMaxPossibleGas({
        relayRequest: {
          request: {
            tokenContract: constants.AddressZero,
          },
          relayData: {
            gasPrice: GAS_PRICE,
          },
        },
      } as EnvelopingTxRequest);

      expect(maxPossibleGas.toString()).to.be.equal(
        fakeEstimationBeforeFees.toString()
      );
    });

    describe('When is not sponsored', function () {
      const FAKE_GAS_FEE_PERCENTAGE = 0.1;
      const FAKE_TRANSFER_FEE_PERCENTAGE = 0.1;
      const TOKEN_AMOUNT_TO_TRANSFER = '1000000000000000000'; //18 zeros
      const TOKEN_AMOUNT_IN_REQUEST = '500000000000000000';

      let dataWhenTransfer: string;
      let dataWhenTransferFrom: string;
      let expectedFeeFromTransfer: BigNumberJs;

      beforeEach(function () {
        mockServer.expects('isSponsorshipAllowed').returns(false);

        const fakeFromAddress =
          '000000000000000000000000e87286ba960fa7aaa5b376083a31d440c8cb4bc8';
        const fakeToAddress =
          '0000000000000000000000008470af7f41ee2788eaa4cfc251927877b659cdc5';
        const tokenAmountToTransferAsHex = BigNumber.from(
          TOKEN_AMOUNT_TO_TRANSFER
        )
          .toHexString()
          .substring(2) //removes 0x
          .padStart(64, '0'); //fills with 0 to the left

        dataWhenTransfer =
          '0x' + TRANSFER_HASH + fakeToAddress + tokenAmountToTransferAsHex;

        dataWhenTransferFrom =
          '0x' +
          TRANSFER_FROM_HASH +
          fakeFromAddress +
          fakeToAddress +
          tokenAmountToTransferAsHex;

        //Calculate the expected fee when a transfer/transferFrom is executed value
        const tokenFee = BigNumberJs(TOKEN_AMOUNT_TO_TRANSFER).multipliedBy(
          FAKE_TRANSFER_FEE_PERCENTAGE
        );
        const tokenFeeAsFraction = toPrecision({
          value: tokenFee,
          precision: -18,
        });
        const feeAsFractionInNative =
          tokenFeeAsFraction.multipliedBy(TOKEN_X_RATE);
        const feeInNative = toPrecision({
          value: feeAsFractionInNative,
          precision: 18,
        });
        expectedFeeFromTransfer = feeInNative.dividedBy(GAS_PRICE);
      });

      it('Should charge fees based on gas when transferFeePercentage = 0', async function () {
        const fakeServerConfigParams = {
          app: {
            feePercentage: FAKE_GAS_FEE_PERCENTAGE,
            transferFeePercentage: 0
          },
        };
        mockServer.expects('isSponsorshipAllowed').returns(false);

        sinon.stub(relayServer, 'config').value(fakeServerConfigParams);

        const maxPossibleGas = await relayServer.getMaxPossibleGas({
          relayRequest: {
            request: {
              tokenContract: constants.AddressZero,
              tokenAmount: TOKEN_AMOUNT_IN_REQUEST,
            },
            relayData: {
              gasPrice: GAS_PRICE,
            },
          },
        } as EnvelopingTxRequest);

        expect(maxPossibleGas.toString()).to.be.eq(
          (
            fakeEstimationBeforeFees +
            fakeEstimationBeforeFees * FAKE_GAS_FEE_PERCENTAGE
          ).toString()
        );
      });

      it('Should charge fees based on gas when transferFeePercentage is not defined', async function () {
        const fakeServerConfigParams = {
          app: {
            feePercentage: FAKE_GAS_FEE_PERCENTAGE,
          },
        };
        mockServer.expects('isSponsorshipAllowed').returns(false);

        sinon.stub(relayServer, 'config').value(fakeServerConfigParams);

        const maxPossibleGas = await relayServer.getMaxPossibleGas({
          relayRequest: {
            request: {
              tokenContract: constants.AddressZero,
              tokenAmount: TOKEN_AMOUNT_IN_REQUEST,
            },
            relayData: {
              gasPrice: GAS_PRICE,
            },
          },
        } as EnvelopingTxRequest);

        expect(maxPossibleGas.toString()).to.be.eq(
          (
            fakeEstimationBeforeFees +
            fakeEstimationBeforeFees * FAKE_GAS_FEE_PERCENTAGE
          ).toString()
        );
      });

      it('Should charge fees based on transfer value, when transferFeePercentage > 0 and a transfer() is being relayed', async function () {
        const fakeServerConfigParams = {
          app: {
            feePercentage: FAKE_GAS_FEE_PERCENTAGE,
            transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
          },
        };
        sinon.stub(relayServer, 'config').value(fakeServerConfigParams);

        const maxPossibleGas = await relayServer.getMaxPossibleGas({
          relayRequest: {
            request: {
              tokenContract: constants.AddressZero,
              tokenAmount: TOKEN_AMOUNT_IN_REQUEST,
              data: dataWhenTransfer,
            },
            relayData: {
              gasPrice: GAS_PRICE,
            },
          },
        } as EnvelopingTxRequest);

        expect(maxPossibleGas.toString()).to.be.eq(
          BigNumberJs(fakeEstimationBeforeFees)
            .plus(expectedFeeFromTransfer)
            .toString()
        );
      });

      it('Should charge fees based on transfer value, when transferFeePercentage > 0 and a transferFrom() is being relayed', async function () {
        const fakeServerConfigParams = {
          app: {
            feePercentage: FAKE_GAS_FEE_PERCENTAGE,
            transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
          },
        };
        sinon.stub(relayServer, 'config').value(fakeServerConfigParams);

        const maxPossibleGas = await relayServer.getMaxPossibleGas({
          relayRequest: {
            request: {
              tokenContract: constants.AddressZero,
              tokenAmount: TOKEN_AMOUNT_IN_REQUEST,
              data: dataWhenTransferFrom,
            },
            relayData: {
              gasPrice: GAS_PRICE,
            },
          },
        } as EnvelopingTxRequest);

        expect(maxPossibleGas.toString()).to.be.eq(
          BigNumberJs(fakeEstimationBeforeFees)
            .plus(expectedFeeFromTransfer)
            .toString()
        );
      });
    });
  });
});
