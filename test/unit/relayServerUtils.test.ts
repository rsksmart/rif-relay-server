import sinon, { SinonStub } from 'sinon';
import type {
  RelayRequestBody,
  EnvelopingRequestData,
  RelayRequest,
} from '@rsksmart/rif-relay-client';
import { BigNumber, constants } from 'ethers';
import {
  ERC20__factory,
  ERC20,
  TokenHandler__factory,
  DestinationContractHandler__factory,
  DestinationContractHandler,
  TokenHandler,
} from '@rsksmart/rif-relay-contracts';
import { expect, use } from 'chai';
import * as Conversions from '../../src/Conversions';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import {
  TRANSFER_HASH,
  TRANSFER_FROM_HASH,
  validateExpirationTime,
} from '../../src/relayServerUtils';
import { toPrecision } from '../../src/Conversions';
import chaiAsPromised from 'chai-as-promised';
import * as relayServerUtils from '../../src/relayServerUtils';
import * as relayClient from '@rsksmart/rif-relay-client';
import type { AppConfig } from 'src';

const ZERO_ADDRESS = constants.AddressZero;
const FAKE_ESTIMATION_BEFORE_FEES = 100000;
const TOKEN_X_RATE = '0.5';
const GAS_PRICE = 10000;
const FAKE_GAS_FEE_PERCENTAGE = 0.1;
const FAKE_TRANSFER_FEE_PERCENTAGE = 0.01;
const FAKE_FIXED_USD_FEE = 2;
const TOKEN_AMOUNT_TO_TRANSFER = '1000000000000000000'; //18 zeros
const TOKEN_VALUE_IN_USD = 0.5;

function createRequest(request: Partial<RelayRequestBody>): RelayRequest {
  const baseRequest: RelayRequest = {
    request: {
      relayHub: ZERO_ADDRESS,
      from: ZERO_ADDRESS,
      to: ZERO_ADDRESS,
      tokenContract: ZERO_ADDRESS,
      value: '0',
      gas: '0',
      nonce: '0',
      tokenAmount: '0',
      tokenGas: '0',
      validUntilTime: '0',
      data: '0x',
    } as RelayRequestBody,
    relayData: {
      gasPrice: GAS_PRICE,
      feesReceiver: ZERO_ADDRESS,
      callForwarder: ZERO_ADDRESS,
      callVerifier: ZERO_ADDRESS,
    } as EnvelopingRequestData,
  } as RelayRequest;

  return {
    request: {
      ...baseRequest.request,
      ...request,
    },
    relayData: {
      ...baseRequest.relayData,
    },
  };
}

use(chaiAsPromised);

describe('relayServerUtils tests', function () {
  afterEach(function () {
    sinon.restore();
  });

  describe('Function calculateFee()', function () {
    let fakeToAddress: string;
    let tokenAmountToTransferAsHex: string;
    let dataWhenTransfer: string;
    let dataWhenTransferFrom: string;
    let expectedFeeFromTransferInTokenGas: BigNumberJs;
    let expectedFeeFromTransferInNativeGas: BigNumberJs;
    let expectedFixedFeeValueInTokenGas: BigNumberJs;
    let expectedFixedFeeValueInNativeGas: BigNumberJs;

    before(function () {
      //Build the data for the transfer() and transferFrom()
      const fakeFromAddress =
        '000000000000000000000000e87286ba960fa7aaa5b376083a31d440c8cb4bc8';
      fakeToAddress =
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
      const feeAsFractionInNative =
        tokenFeeAsFraction.multipliedBy(TOKEN_X_RATE);
      const feeInNative = toPrecision({
        value: feeAsFractionInNative,
        precision: 18,
      });
      expectedFeeFromTransferInTokenGas = feeInNative.dividedBy(GAS_PRICE);
      expectedFeeFromTransferInNativeGas = tokenFee.dividedBy(GAS_PRICE);

      //Calculate the expected fixed fee value
      const exchangeRate = 1 / TOKEN_VALUE_IN_USD;
      const fixedFeeInToken = BigNumberJs(exchangeRate * FAKE_FIXED_USD_FEE);
      const fixedFeeInTokenWithPrecision = toPrecision({
        value: fixedFeeInToken,
        precision: 18,
      });
      const fixedFeeAsFractionInNative =
        fixedFeeInTokenWithPrecision.multipliedBy(TOKEN_X_RATE);
      expectedFixedFeeValueInTokenGas =
        fixedFeeAsFractionInNative.dividedBy(GAS_PRICE);
      expectedFixedFeeValueInNativeGas =
        fixedFeeInTokenWithPrecision.dividedBy(GAS_PRICE);
    });

    beforeEach(function () {
      const token = {
        name: () => Promise.resolve('TestToken'),
        symbol: () => Promise.resolve('TT'),
        decimals: () => Promise.resolve(18),
      } as unknown as ERC20;
      sinon.stub(ERC20__factory, 'connect').returns(token);

      sinon.stub(Conversions, 'getXRateFor').resolves(TOKEN_X_RATE);
    });

    it('Should return 0 when it is sponsored even if fees are configured', async function () {
      const request = createRequest({});
      const config = {
        disableSponsoredTx: false,
        gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
        transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
        fixedUsdFee: FAKE_FIXED_USD_FEE,
      } as unknown as AppConfig;

      const fee = await relayServerUtils.calculateFee(
        request,
        BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
        config
      );

      expect(fee.toString()).to.eq('0');
    });

    describe('When is not sponsored', function () {
      describe('Transfer fee scenarios', function () {
        describe('Using ERC20 token', function () {
          it('Should charge transferFee when a transfer is being relayed', async function () {
            const request = createRequest({
              data: dataWhenTransfer,
              tokenContract: fakeToAddress,
            });

            const config = {
              disableSponsoredTx: true,
              sponsoredDestinations: [],
              gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
              transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
            } as unknown as AppConfig;

            const fee = await relayServerUtils.calculateFee(
              request,
              BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
              config
            );

            expect(fee.toString()).to.eq(
              expectedFeeFromTransferInTokenGas.toString()
            );
          });

          it('Should charge transferFee when a transferFrom is being relayed', async function () {
            const request = createRequest({
              data: dataWhenTransferFrom,
              tokenContract: fakeToAddress,
            });

            const config = {
              disableSponsoredTx: true,
              sponsoredDestinations: [],
              gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
              transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
            } as unknown as AppConfig;

            const fee = await relayServerUtils.calculateFee(
              request,
              BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
              config
            );

            expect(fee.toString()).to.eq(
              expectedFeeFromTransferInTokenGas.toString()
            );
          });
        });

        describe('Using native token', function () {
          it('Should charge transferFee when a transfer is being relayed', async function () {
            const request = createRequest({
              data: dataWhenTransfer,
            });

            const config = {
              disableSponsoredTx: true,
              sponsoredDestinations: [],
              gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
              transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
            } as unknown as AppConfig;

            const fee = await relayServerUtils.calculateFee(
              request,
              BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
              config
            );

            expect(fee.toString()).to.eq(
              expectedFeeFromTransferInNativeGas.toString()
            );
          });

          it('Should charge transferFee when a transferFrom is being relayed', async function () {
            const request = createRequest({
              data: dataWhenTransferFrom,
            });

            const config = {
              disableSponsoredTx: true,
              sponsoredDestinations: [],
              gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
              transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
            } as unknown as AppConfig;

            const fee = await relayServerUtils.calculateFee(
              request,
              BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
              config
            );

            expect(fee.toString()).to.eq(
              expectedFeeFromTransferInNativeGas.toString()
            );
          });
        });

        it('Should not charge extra fees when a transfer() with value = 0 is being relayed', async function () {
          const dataWhenTransferingZero = dataWhenTransfer.replace(
            tokenAmountToTransferAsHex,
            '0'.repeat(64)
          );

          const request = createRequest({
            data: dataWhenTransferingZero,
          });

          const config = {
            disableSponsoredTx: true,
            sponsoredDestinations: [],
            gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
            transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
          } as unknown as AppConfig;

          const fee = await relayServerUtils.calculateFee(
            request,
            BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
            config
          );

          expect(fee.toString()).to.eq('0');
        });

        it('Should not charge extra fees when a transferFrom() with value = 0 is being relayed', async function () {
          const dataWhenTransferingZero = dataWhenTransferFrom.replace(
            tokenAmountToTransferAsHex,
            '0'.repeat(64)
          );

          const request = createRequest({
            data: dataWhenTransferingZero,
          });

          const config = {
            disableSponsoredTx: true,
            sponsoredDestinations: [],
            gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
            transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
          } as unknown as AppConfig;

          const fee = await relayServerUtils.calculateFee(
            request,
            BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
            config
          );

          expect(fee.toString()).to.eq('0');
        });

        it('Should not charge extra fees when transferFee = 0 and a transfer is being relayed', async function () {
          const request = createRequest({
            data: dataWhenTransfer,
          });

          const config = {
            disableSponsoredTx: true,
            sponsoredDestinations: [],
            gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
            transferFeePercentage: 0,
          } as unknown as AppConfig;

          const fee = await relayServerUtils.calculateFee(
            request,
            BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
            config
          );

          expect(fee.toString()).to.eq('0');
        });

        it('Should not charge extra fees when transferFee = 0 and a transferFrom is being relayed', async function () {
          const request = createRequest({
            data: dataWhenTransferFrom,
          });

          const config = {
            disableSponsoredTx: true,
            sponsoredDestinations: [],
            gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
            transferFeePercentage: 0,
          } as unknown as AppConfig;

          const fee = await relayServerUtils.calculateFee(
            request,
            BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
            config
          );

          expect(fee.toString()).to.eq('0');
        });
      });

      describe('Gas fee scenarios', function () {
        it('Should charge gas fee when transferFee is not configured', async function () {
          const request = createRequest({});

          const config = {
            disableSponsoredTx: true,
            sponsoredDestinations: [],
            gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
          } as unknown as AppConfig;

          const fee = await relayServerUtils.calculateFee(
            request,
            BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
            config
          );

          expect(fee.toString()).to.eq(
            BigNumberJs(FAKE_ESTIMATION_BEFORE_FEES)
              .multipliedBy(FAKE_GAS_FEE_PERCENTAGE)
              .toString()
          );
        });

        it('Should not charge extra fees when transferGas = 0', async function () {
          const request = createRequest({});

          const config = {
            disableSponsoredTx: true,
            sponsoredDestinations: [],
            gasFeePercentage: 0,
          } as unknown as AppConfig;

          const fee = await relayServerUtils.calculateFee(
            request,
            BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
            config
          );

          expect(fee.toString()).to.eq('0');
        });

        it('Should charge fees based on gas when transferFee is configured but it is not a transfer/transferFrom', async function () {
          const request = createRequest({
            data: '0x',
          });

          const config = {
            disableSponsoredTx: true,
            sponsoredDestinations: [],
            gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
            tranferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
          } as unknown as AppConfig;

          const fee = await relayServerUtils.calculateFee(
            request,
            BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
            config
          );

          expect(fee.toString()).to.eq(
            BigNumberJs(FAKE_ESTIMATION_BEFORE_FEES)
              .multipliedBy(FAKE_GAS_FEE_PERCENTAGE)
              .toString()
          );
        });
      });

      describe('Fixed fee scenarios', function () {
        beforeEach(function () {
          sinon.replaceGetter(relayClient, 'getExchangeRate', () =>
            sinon.stub().resolves(BigNumberJs(1 / TOKEN_VALUE_IN_USD))
          );
        });

        describe('Using ERC20 token', function () {
          it('Should charge fixedFee when properly configured', async function () {
            const request = createRequest({ tokenContract: fakeToAddress });

            const config = {
              disableSponsoredTx: true,
              sponsoredDestinations: [],
              gasFeePercentage: 0,
              transferFeePercentage: 0,
              fixedUsdFee: FAKE_FIXED_USD_FEE,
            } as unknown as AppConfig;

            const fee = await relayServerUtils.calculateFee(
              request,
              BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
              config
            );

            expect(fee.toString()).to.eq(
              expectedFixedFeeValueInTokenGas.toString()
            );
          });

          it('Should charge fixedFee + gasFee when both are configured', async function () {
            const request = createRequest({ tokenContract: fakeToAddress });

            const config = {
              disableSponsoredTx: true,
              sponsoredDestinations: [],
              gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
              fixedUsdFee: FAKE_FIXED_USD_FEE,
            } as unknown as AppConfig;

            const fee = await relayServerUtils.calculateFee(
              request,
              BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
              config
            );

            expect(fee.toString()).to.eq(
              BigNumberJs(FAKE_ESTIMATION_BEFORE_FEES)
                .multipliedBy(FAKE_GAS_FEE_PERCENTAGE)
                .plus(expectedFixedFeeValueInTokenGas)
                .toString()
            );
          });

          it('Should charge fixedFee + transferFee when both are configured and a transfer is being relayed', async function () {
            const request = createRequest({
              data: dataWhenTransfer,
              tokenContract: fakeToAddress,
            });

            const config = {
              disableSponsoredTx: true,
              sponsoredDestinations: [],
              transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
              fixedUsdFee: FAKE_FIXED_USD_FEE,
            } as unknown as AppConfig;

            const fee = await relayServerUtils.calculateFee(
              request,
              BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
              config
            );

            expect(fee.toString()).to.eq(
              BigNumberJs(expectedFeeFromTransferInTokenGas)
                .plus(expectedFixedFeeValueInTokenGas)
                .toString()
            );
          });
        });

        describe('Using native token', function () {
          it('Should charge fixedFee when properly configured', async function () {
            const request = createRequest({});

            const config = {
              disableSponsoredTx: true,
              sponsoredDestinations: [],
              gasFeePercentage: 0,
              transferFeePercentage: 0,
              fixedUsdFee: FAKE_FIXED_USD_FEE,
            } as unknown as AppConfig;

            const fee = await relayServerUtils.calculateFee(
              request,
              BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
              config
            );

            expect(fee.toString()).to.eq(
              expectedFixedFeeValueInNativeGas.toString()
            );
          });

          it('Should charge fixedFee + gasFee when both are configured', async function () {
            const request = createRequest({});

            const config = {
              disableSponsoredTx: true,
              sponsoredDestinations: [],
              gasFeePercentage: FAKE_GAS_FEE_PERCENTAGE,
              fixedUsdFee: FAKE_FIXED_USD_FEE,
            } as unknown as AppConfig;

            const fee = await relayServerUtils.calculateFee(
              request,
              BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
              config
            );

            expect(fee.toString()).to.eq(
              BigNumberJs(FAKE_ESTIMATION_BEFORE_FEES)
                .multipliedBy(FAKE_GAS_FEE_PERCENTAGE)
                .plus(expectedFixedFeeValueInNativeGas)
                .toString()
            );
          });

          it('Should charge fixedFee + transferFee when both are configured and a transfer is being relayed', async function () {
            const request = createRequest({
              data: dataWhenTransfer,
            });

            const config = {
              disableSponsoredTx: true,
              sponsoredDestinations: [],
              transferFeePercentage: FAKE_TRANSFER_FEE_PERCENTAGE,
              fixedUsdFee: FAKE_FIXED_USD_FEE,
            } as unknown as AppConfig;

            const fee = await relayServerUtils.calculateFee(
              request,
              BigNumber.from(FAKE_ESTIMATION_BEFORE_FEES),
              config
            );

            expect(fee.toString()).to.eq(
              BigNumberJs(expectedFeeFromTransferInNativeGas)
                .plus(expectedFixedFeeValueInNativeGas)
                .toString()
            );
          });
        });
      });
    });
  });

  describe('Function validateExpirationTime()', function () {
    const MINIMUM_ACCEPTABLE_TIME = 1000;

    it('should throw an error if the time is expired', async function () {
      const nowInSeconds = Math.round(Date.now() / 1000);
      const threeSecondsBefore = nowInSeconds - 3;

      await expect(
        validateExpirationTime(threeSecondsBefore, MINIMUM_ACCEPTABLE_TIME)
      ).to.be.rejectedWith('Request expired (or too close)');
    });

    it('should throw an error if the time is about to expire', async function () {
      const nowInSeconds = Math.round(Date.now() / 1000);
      const threeSecondsBefore = nowInSeconds + (MINIMUM_ACCEPTABLE_TIME - 1);

      await expect(
        validateExpirationTime(threeSecondsBefore, MINIMUM_ACCEPTABLE_TIME)
      ).to.be.rejectedWith('Request expired (or too close)');
    });

    it('should not throw an error if the time is greater than the minimum acceptable time', async function () {
      const nowInSeconds = Math.round(Date.now() / 1000);
      const threeSecondsBefore = nowInSeconds + MINIMUM_ACCEPTABLE_TIME;

      await expect(
        validateExpirationTime(threeSecondsBefore, MINIMUM_ACCEPTABLE_TIME)
      ).not.to.be.rejected;
    });
  });

  describe('Function callVerifierMethod()', function () {
    const addressArray = ['0x145845fd06c85B7EA1AA2d030E1a747B3d8d15D7'];
    const verifier = '0x155845fd06c85B7EA1AA2d030E1a747B3d8d15D7';
    let getAcceptedTokens: SinonStub;
    let getAcceptedContracts: SinonStub;

    beforeEach(function () {
      getAcceptedTokens = sinon.stub().resolves(addressArray);
      const tokenHandler = {
        getAcceptedTokens,
      } as unknown as TokenHandler;
      sinon.stub(TokenHandler__factory, 'connect').returns(tokenHandler);

      getAcceptedContracts = sinon.stub().resolves(addressArray);
      const contractHandler = {
        getAcceptedContracts,
      } as unknown as DestinationContractHandler;
      sinon
        .stub(DestinationContractHandler__factory, 'connect')
        .returns(contractHandler);
    });

    it('should return accepted tokens', async function () {
      const tokens = await relayServerUtils.callVerifierMethod(
        verifier,
        'Token'
      );

      expect(getAcceptedTokens).to.be.calledOnce;
      expect(tokens).to.be.equal(addressArray);
    });

    it('should return accepted contracts', async function () {
      const contracts = await relayServerUtils.callVerifierMethod(
        verifier,
        'Contract'
      );

      expect(getAcceptedContracts).to.be.calledOnce;
      expect(contracts).to.be.equal(addressArray);
    });

    it('should return empty if it fails while retrieving accepted tokens', async function () {
      getAcceptedTokens.throws();
      const tokens = await relayServerUtils.callVerifierMethod(
        verifier,
        'Token'
      );

      expect(getAcceptedTokens).to.be.calledOnce;
      expect(tokens).to.be.empty;
    });

    it('should return empty if it fails while retrieving accepted contracts', async function () {
      getAcceptedContracts.throws();
      const contracts = await relayServerUtils.callVerifierMethod(
        verifier,
        'Contract'
      );

      expect(getAcceptedContracts).to.be.calledOnce;
      expect(contracts).to.be.empty;
    });
  });

  describe('Function queryVerifiers()', function () {
    let trustedVerifiers: Set<string>;
    const verifier = '0x145845fd06c85B7EA1AA2d030E1a747B3d8d15D7';

    before(function () {
      trustedVerifiers = new Set<string>();
      trustedVerifiers.add(verifier.toLowerCase());
      trustedVerifiers.add(
        '0x155845fd06c85B7EA1AA2d030E1a747B3d8d15D7'.toLowerCase()
      );
    });

    it('should return verifiers if verifier not provided', function () {
      const verifiers = relayServerUtils.queryVerifiers(
        undefined,
        trustedVerifiers
      );

      expect(verifiers).to.be.deep.equal(Array.from(trustedVerifiers));
    });

    it('should return trusted verifier', function () {
      const verifiers = relayServerUtils.queryVerifiers(
        verifier,
        trustedVerifiers
      );

      expect(verifiers).to.be.deep.equal([verifier]);
    });

    it('should throw error if verifier is not trusted', function () {
      expect(() =>
        relayServerUtils.queryVerifiers(
          '0x165845fd06c85B7EA1AA2d030E1a747B3d8d15D7',
          trustedVerifiers
        )
      ).throw('Supplied verifier is not trusted');
    });
  });
});
