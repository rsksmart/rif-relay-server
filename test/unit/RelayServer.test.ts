import { KeyManager, RelayServer, TxStoreManager } from '../../src';
import sinon, { mock, createStubInstance } from 'sinon';
import type { EnvelopingTxRequest } from '@rsksmart/rif-relay-client';
import * as rifClient from '@rsksmart/rif-relay-client';
import { BigNumber, constants, providers } from 'ethers';
import * as utils from '../../src/Utils';
import { ERC20__factory, ERC20 } from '@rsksmart/rif-relay-contracts';
import { expect, use } from 'chai';
import * as Conversions from '../../src/Conversions';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import { TRANSFER_HASH, TRANSFER_FROM_HASH } from '../../src/relayServerUtils';
import { toPrecision } from '../../src/Conversions';
import chaiAsPromised from 'chai-as-promised';
import * as relayServerUtils from '../../src/relayServerUtils';

use(chaiAsPromised);

describe('RelayServer tests', function () {
  const FAKE_ESTIMATION_BEFORE_FEES = 100000;
  const TOKEN_X_RATE = '0.5';
  const GAS_PRICE = 10000;
  const FAKE_GAS_FEE_PERCENTAGE = 0.1;
  const FAKE_TRANSFER_FEE_PERCENTAGE = 0.1;
  const TOKEN_AMOUNT_TO_TRANSFER = '1000000000000000000'; //18 zeros
  const TOKEN_AMOUNT_IN_REQUEST = '500000000000000000'; //17 zeros

  let relayServer: RelayServer;
  let mockServer: sinon.SinonMock;
  let tokenAmountToTransferAsHex: string;
  let dataWhenTransfer: string;
  let dataWhenTransferFrom: string;
  let expectedFeeFromTransfer: BigNumberJs;

  before(function () {
    //Build the data for the transfer() and transferFrom()
    const fakeFromAddress =
      '000000000000000000000000e87286ba960fa7aaa5b376083a31d440c8cb4bc8';
    const fakeToAddress =
      '0000000000000000000000008470af7f41ee2788eaa4cfc251927877b659cdc5';
    tokenAmountToTransferAsHex = BigNumber.from(TOKEN_AMOUNT_TO_TRANSFER)
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

    //Calculate the expected fee value when a transfer/transferFrom is executed
    const tokenFee = BigNumberJs(TOKEN_AMOUNT_TO_TRANSFER).multipliedBy(
      FAKE_TRANSFER_FEE_PERCENTAGE
    );
    const tokenFeeAsFraction = toPrecision({
      value: tokenFee,
      precision: -18,
    });
    const feeAsFractionInNative = tokenFeeAsFraction.multipliedBy(TOKEN_X_RATE);
    const feeInNative = toPrecision({
      value: feeAsFractionInNative,
      precision: 18,
    });
    expectedFeeFromTransfer = feeInNative.dividedBy(GAS_PRICE);
  });

  beforeEach(function () {
    //Build and mock server
    const managerKeyManager = createStubInstance(KeyManager);
    const workersKeyManager = createStubInstance(KeyManager);
    const txStoreManager = createStubInstance(TxStoreManager);

    relayServer = new RelayServer({
      managerKeyManager,
      txStoreManager,
      workersKeyManager,
    });

    mockServer = mock(relayServer);

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
    it('Should not charge fees when is sponsored', async function () {
      mockServer.expects('isSponsorshipAllowed').returns(true);

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

    describe('When is not sponsored', function () {
      beforeEach(function () {
        mockServer.expects('isSponsorshipAllowed').returns(false);
      });

      it('Should charge fees based on gas when transferFeePercentage is not defined', async function () {
        const fakeServerConfigParams = {
          app: {
            gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
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
            FAKE_ESTIMATION_BEFORE_FEES +
            FAKE_ESTIMATION_BEFORE_FEES * FAKE_GAS_FEE_PERCENTAGE
          ).toString()
        );
      });
      describe('When transferFeePercentage is defined', function () {
        beforeEach(function () {
          const fakeServerConfigParams = {
            app: {
              gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
              transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
            },
          };
          sinon.stub(relayServer, 'config').value(fakeServerConfigParams);
        });

        it('Should charge fees based on transfer value, when a transfer() is being relayed', async function () {
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
            BigNumberJs(FAKE_ESTIMATION_BEFORE_FEES)
              .plus(expectedFeeFromTransfer)
              .toString()
          );
        });

        it('Should charge fees based on transfer value, when a transferFrom() is being relayed', async function () {
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
            BigNumberJs(FAKE_ESTIMATION_BEFORE_FEES)
              .plus(expectedFeeFromTransfer)
              .toString()
          );
        });

        it('Should charge fees based on gas when it is not a transfer/transferFrom', async function () {
          //This just changes the hash of the method so is not a tranfer/transferFrom anymore
          const dataWhenNoTransfer = dataWhenTransfer.replace('a', 'b');

          const maxPossibleGaseEstimation =
            await relayServer.estimateMaxPossibleGas({
              relayRequest: {
                request: {
                  tokenContract: constants.AddressZero,
                  data: dataWhenNoTransfer,
                },
                relayData: {
                  gasPrice: GAS_PRICE,
                },
              },
            } as EnvelopingTxRequest);

          expect(maxPossibleGaseEstimation.estimation).to.be.eq(
            (
              FAKE_ESTIMATION_BEFORE_FEES +
              FAKE_ESTIMATION_BEFORE_FEES * FAKE_GAS_FEE_PERCENTAGE
            ).toString()
          );
        });

        describe('When the value to transfer is zero', function () {
          let dataWhenTransferingZero: string;

          before(function () {
            dataWhenTransferingZero = dataWhenTransfer.replace(
              tokenAmountToTransferAsHex,
              '0'.repeat(64)
            );
          });

          it('Should not charge fees when a transfer() is being relayed', async function () {
            const maxPossibleGaseEstimation =
              await relayServer.estimateMaxPossibleGas({
                relayRequest: {
                  request: {
                    tokenContract: constants.AddressZero,
                    data: dataWhenTransferingZero,
                  },
                  relayData: {
                    gasPrice: GAS_PRICE,
                  },
                },
              } as EnvelopingTxRequest);

            expect(maxPossibleGaseEstimation.estimation).to.be.eq(
              FAKE_ESTIMATION_BEFORE_FEES.toString()
            );
          });

          it('Should not charge fees when a transferFrom() is being relayed', async function () {
            const maxPossibleGaseEstimation =
              await relayServer.estimateMaxPossibleGas({
                relayRequest: {
                  request: {
                    tokenContract: constants.AddressZero,
                    data: dataWhenTransferingZero,
                  },
                  relayData: {
                    gasPrice: GAS_PRICE,
                  },
                },
              } as EnvelopingTxRequest);

            expect(maxPossibleGaseEstimation.estimation).to.be.eq(
              FAKE_ESTIMATION_BEFORE_FEES.toString()
            );
          });
        });

        describe('When transferFeePercentage = 0', function () {
          beforeEach(function () {
            const fakeServerConfigParams = {
              app: {
                gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
                transferFeePercentage: 0,
              },
            };
            sinon.stub(relayServer, 'config').value(fakeServerConfigParams);
          });

          it('Should sponsor transfer() operations', async function () {
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
              FAKE_ESTIMATION_BEFORE_FEES.toString()
            );
          });

          it('Should sponsor transferFrom() operations', async function () {
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
              FAKE_ESTIMATION_BEFORE_FEES.toString()
            );
          });
        });
      });
    });
  });

  describe('Function getMaxPossibleGas()', function () {
    beforeEach(function () {
      sinon
        .stub(relayServerUtils, 'validateIfGasAmountIsAcceptable')
        .resolves();
    });

    //Skiping this test for lack of tools to stub/mock non configurable properties (isDeployTransaction and estimateInternalCallGas).
    //Both functions are not configurable (try Object.getOwnPropertyDescriptor(rifClient, 'estimateInternalCallGas') to know).
    it.skip('Should fail if the gas amount is lower than required', async function () {
      const fakeRequiredGas = 20000;
      //This is the failing line:
      // sinon.replaceGetter(rifClient, 'isDeployTransaction', () =>
      //   sinon.stub().returns(false)
      // );

      //This one has no compilation issues but is not doing what is supposed to do
      sinon.replaceGetter(rifClient, 'estimateInternalCallGas', () =>
        sinon.stub().resolves(BigNumber.from(fakeRequiredGas))
      );

      await expect(
        relayServer.getMaxPossibleGas({
          relayRequest: {
            request: {
              gas: fakeRequiredGas - 10000,
            },
            relayData: {
              gasPrice: GAS_PRICE,
            },
          },
        } as EnvelopingTxRequest)
      ).to.be.rejectedWith(
        "Request payload's gas parameters deviate too much fom the estimated gas for this transaction"
      );
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
        FAKE_ESTIMATION_BEFORE_FEES.toString()
      );
    });

    describe('When is not sponsored', function () {
      beforeEach(function () {
        mockServer.expects('isSponsorshipAllowed').returns(false);
      });

      it('Should charge fees based on gas when transferFeePercentage is not defined', async function () {
        const fakeServerConfigParams = {
          app: {
            gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
          },
        };

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
            FAKE_ESTIMATION_BEFORE_FEES +
            FAKE_ESTIMATION_BEFORE_FEES * FAKE_GAS_FEE_PERCENTAGE
          ).toString()
        );
      });

      describe('When transferFeePercentage is defined', function () {
        beforeEach(function () {
          const fakeServerConfigParams = {
            app: {
              gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
              transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
            },
          };
          sinon.stub(relayServer, 'config').value(fakeServerConfigParams);
        });

        it('Should charge fees based on transfer value, when  and a transfer() is being relayed', async function () {
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
            BigNumberJs(FAKE_ESTIMATION_BEFORE_FEES)
              .plus(expectedFeeFromTransfer)
              .toString()
          );
        });

        it('Should charge fees based on transfer value, when a transferFrom() is being relayed', async function () {
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
            BigNumberJs(FAKE_ESTIMATION_BEFORE_FEES)
              .plus(expectedFeeFromTransfer)
              .toString()
          );
        });

        it('Should fail when the token amount sent in request is lower than required', async function () {
          const lowTokenAmount = '50000000';

          await expect(
            relayServer.getMaxPossibleGas({
              relayRequest: {
                request: {
                  tokenContract: constants.AddressZero,
                  tokenAmount: lowTokenAmount,
                  data: dataWhenTransfer,
                },
                relayData: {
                  gasPrice: GAS_PRICE,
                },
              },
            } as EnvelopingTxRequest)
          ).to.be.rejectedWith(
            'User agreed to spend lower than what the transaction may require'
          );
        });
        describe('When the value to transfer is zero', function () {
          let dataWhenTransferingZero: string;

          beforeEach(function () {
            dataWhenTransferingZero = dataWhenTransfer.replace(
              tokenAmountToTransferAsHex,
              '0'.repeat(64)
            );
          });

          it('Should not charge fees if the amount to transfer is zero when a transfer() is being relayed', async function () {
            const maxPossibleGas = await relayServer.getMaxPossibleGas({
              relayRequest: {
                request: {
                  tokenContract: constants.AddressZero,
                  tokenAmount: TOKEN_AMOUNT_IN_REQUEST,
                  data: dataWhenTransferingZero,
                },
                relayData: {
                  gasPrice: GAS_PRICE,
                },
              },
            } as EnvelopingTxRequest);

            expect(maxPossibleGas.toString()).to.be.eq(
              FAKE_ESTIMATION_BEFORE_FEES.toString()
            );
          });

          it('Should not charge fees if the amount to transfer is zero when a transferFrom() is being relayed', async function () {
            const maxPossibleGas = await relayServer.getMaxPossibleGas({
              relayRequest: {
                request: {
                  tokenContract: constants.AddressZero,
                  tokenAmount: TOKEN_AMOUNT_IN_REQUEST,
                  data: dataWhenTransferingZero,
                },
                relayData: {
                  gasPrice: GAS_PRICE,
                },
              },
            } as EnvelopingTxRequest);

            expect(maxPossibleGas.toString()).to.be.eq(
              FAKE_ESTIMATION_BEFORE_FEES.toString()
            );
          });
        });
      });

      describe('When tranferFeePercentage = 0', function () {
        beforeEach(function () {
          const fakeServerConfigParams = {
            app: {
              gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
              transferFeePercentage: 0,
            },
          };
          sinon.stub(relayServer, 'config').value(fakeServerConfigParams);
        });

        it('Should sponsor tranfer() operations', async function () {
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
            FAKE_ESTIMATION_BEFORE_FEES.toString()
          );
        });

        it('Should sponsor tranferFrom() operations', async function () {
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
            FAKE_ESTIMATION_BEFORE_FEES.toString()
          );
        });
      });
    });
  });

  describe('Comparisons between estimateMaxPossibleGas() and getMaxPossibleGas()', function () {
    beforeEach(function () {
      sinon
        .stub(relayServerUtils, 'validateIfGasAmountIsAcceptable')
        .resolves();
      mockServer.expects('isSponsorshipAllowed').returns(false);

      const fakeServerConfigParams = {
        app: {
          gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
          transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
        },
      };
      sinon.stub(relayServer, 'config').value(fakeServerConfigParams);
    });

    //Technically the estimation can be slightly greater but here we are using stubs so they should be equal
    it('Value obtained from estimation should be equal to value required on execution', async function () {
      const estimatedGas = await relayServer.estimateMaxPossibleGas({
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

      mockServer.expects('isSponsorshipAllowed').returns(false);

      const requiredGas = await relayServer.getMaxPossibleGas({
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

      expect(estimatedGas.estimation.toString()).to.be.eq(
        requiredGas.toString()
      );
    });
  });
});
