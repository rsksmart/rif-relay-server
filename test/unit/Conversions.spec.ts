/* import { RelayPricer } from '@rsksmart/rif-relay-client';
import { ERC20Instance } from '@rsksmart/rif-relay-contracts/types/truffle-contracts';
import BigNumber from 'bignumber.js';
import { expect, use, assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon, { SinonStubbedInstance } from 'sinon';
import sinonChai from 'sinon-chai';
import {
  getXRateFor,
  toNativeWeiFrom,
  toPrecision,
  convertGasToToken,
  convertGasToNative,
} from '../../src/Conversions';
import ExchangeToken from '../../src/definitions/token.type';

use(sinonChai);
use(chaiAsPromised);

describe('Conversions', () => {
  let erc20Instance: SinonStubbedInstance<ERC20Instance>;
  const xRateRifRbtc = new BigNumber('0.00000332344907316948');

  afterEach(() => {
    sinon.restore();
  });

  describe('getXRateFor', async () => {
    it('should return exchange rate of given token', async () => {
      sinon
        .stub(RelayPricer.prototype, 'getExchangeRate')
        .returns(Promise.resolve(xRateRifRbtc));
      const expectedXRate: BigNumber = xRateRifRbtc;
      const token: ExchangeToken = {
        instance: erc20Instance,
        decimals: 18,
        name: 'tRIF',
        symbol: 'RIF',
      };

      const actualXRate: BigNumberJs = await getXRateFor(token);

      expect(
        actualXRate.isEqualTo(expectedXRate),
        `${actualXRate} should equal ${expectedXRate}`
      ).to.be.true;
    });

    it('should fail if token is does not have symbol', async () => {
      const error = Error('There is no available API for token undefined');
      sinon
        .stub(RelayPricer.prototype, 'getExchangeRate')
        .returns(Promise.reject(error));
      const token: ExchangeToken = {
        instance: erc20Instance,
        decimals: 18,
        name: '',
      };
      await assert.isRejected(getXRateFor(token), error.message);
    });

    it('should fail if token does not exist', async () => {
      const error = Error('There is no available API for token NA');
      sinon
        .stub(RelayPricer.prototype, 'getExchangeRate')
        .returns(Promise.reject(error));
      const token: ExchangeToken = {
        instance: erc20Instance,
        decimals: 18,
        name: 'NA',
        symbol: 'NA',
      };
      await assert.isRejected(getXRateFor(token), error.message);
    });
  });

  describe('toNativeWeiFrom', () => {
    it('should convert given token amount to given currency', async () => {
      const expectedCurrencyAmount = BigNumberJs(3).multipliedBy(
        BigNumberJs(10).pow(13)
      ); // 3e13 'wei' -> 0.00003 rbtc
      const exchangeRate = BigNumberJs(0.00016);
      const tokenAmount: BigNumberJs =
        expectedCurrencyAmount.dividedBy(exchangeRate);

      const token: ExchangeToken = {
        instance: erc20Instance,
        decimals: 18,
        name: 'tRIF',
        amount: tokenAmount,
        xRate: exchangeRate,
        symbol: 'RIF',
      };

      const actualCurrencyAmount = await toNativeWeiFrom(token);

      expect(
        actualCurrencyAmount.eq(expectedCurrencyAmount),
        `${actualCurrencyAmount.toString()} should equal ${expectedCurrencyAmount.toString()}`
      ).to.be.true;
    });

    it('should convert between different decimal systems', async () => {
      const erc20Decimals = 22;

      const exchangeRate: BigNumber = xRateRifRbtc;
      const tokenAmount: BigNumber = new BigNumber(
        '3'.padEnd(erc20Decimals, '0')
      );

      const nativeWeiDecimals = 18;

      const token: ExchangeToken = {
        instance: erc20Instance,
        decimals: erc20Decimals,
        name: 'tRIF_22',
        symbol: 'RIF_22',
        amount: tokenAmount,
        xRate: exchangeRate,
      };

      const tokenAsFraction = toPrecision({
        value: token.amount ?? 0,
        precision: -(token.decimals ?? 18),
      });

      const tokenInNativeWei = toPrecision({
        value: tokenAsFraction.multipliedBy(exchangeRate),
        precision: nativeWeiDecimals,
      });

      const expectedWeiAmount = tokenInNativeWei;

      const actualCurrencyAmount = await toNativeWeiFrom(token);

      expect(
        actualCurrencyAmount.eq(expectedWeiAmount),
        `${actualCurrencyAmount.toString()} should equal ${expectedWeiAmount.toString()}`
      ).to.be.true;
    });
  });

  describe('convertGasToToken', function () {
    let erc20Instance: SinonStubbedInstance<ERC20Instance>;
    let token: ExchangeToken;
    const exchangeRate: BigNumber = xRateRifRbtc;
    const estimation = BigNumber(145000);
    const gasPrice = BigNumber(60000000);

    beforeEach(function () {
      token = {
        instance: erc20Instance,
        name: 'tRif',
        symbol: 'RIF',
        decimals: 18,
      };
    });

    it('should return token amount', function () {
      const tokenAmount = convertGasToToken(
        estimation,
        { ...token, xRate: exchangeRate },
        gasPrice
      );
      const expectedTokenAmount = estimation
        .multipliedBy(gasPrice)
        .dividedBy(exchangeRate);
      expect(
        tokenAmount.eq(expectedTokenAmount),
        `${tokenAmount.toString()} should equal ${expectedTokenAmount.toString()}`
      ).to.be.true;
    });

    it('should return 0 if estimation is negative', function () {
      const tokenAmount = convertGasToToken(
        -1,
        { ...token, xRate: exchangeRate },
        gasPrice
      );
      expect(tokenAmount.isZero(), 'token amount should be zero').to.be.true;
    });

    it('should return 0 if exchange rate is negative', function () {
      const tokenAmount = convertGasToToken(
        estimation,
        { ...token, xRate: new BigNumber(-1) },
        gasPrice
      );
      expect(tokenAmount.isZero(), 'token amount should be zero').to.be.true;
    });

    it('should return 0 if gas price is negative', function () {
      const tokenAmount = convertGasToToken(
        estimation,
        { ...token, xRate: exchangeRate },
        -1
      );
      expect(tokenAmount.isZero(), 'token amount should be zero').to.be.true;
    });

    it('should return 0 if estimation is zero', function () {
      const tokenAmount = convertGasToToken(
        0,
        { ...token, xRate: exchangeRate },
        gasPrice
      );
      expect(tokenAmount.isZero(), 'token amount should be zero').to.be.true;
    });

    it('should return 0 if exchange rate is zero', function () {
      const tokenAmount = convertGasToToken(
        estimation,
        { ...token, xRate: new BigNumber(0) },
        gasPrice
      );
      expect(tokenAmount.isZero(), 'token amount should be zero').to.be.true;
    });

    it('should return 0 if gas price is zero', function () {
      const tokenAmount = convertGasToToken(
        estimation,
        { ...token, xRate: exchangeRate },
        0
      );
      expect(tokenAmount.isZero(), 'token amount should be zero').to.be.true;
    });

    it('should return 0 if estimation is invalid', function () {
      const tokenAmount = convertGasToToken(
        'na',
        { ...token, xRate: exchangeRate },
        gasPrice
      );
      expect(tokenAmount.isZero(), 'token amount should be zero').to.be.true;
    });

    it('should return 0 if exchange rate is invalid', function () {
      const tokenAmount = convertGasToToken(
        estimation,
        { ...token, xRate: new BigNumber(-1) },
        gasPrice
      );
      expect(tokenAmount.isZero(), 'token amount should be zero').to.be.true;
    });

    it('should return 0 if gas price is invalid', function () {
      const tokenAmount = convertGasToToken(
        estimation,
        { ...token, xRate: exchangeRate },
        'na'
      );
      expect(tokenAmount.isZero(), 'token amount should be zero').to.be.true;
    });
  });

  describe('convertGasToNative', function () {
    const estimation = BigNumber(145000);
    const gasPrice = BigNumber(60000000);

    it('should return native amount', function () {
      const nativeAmount = convertGasToNative(estimation, gasPrice);
      const expectedNative = estimation.multipliedBy(gasPrice);
      expect(
        nativeAmount.eq(expectedNative),
        `${nativeAmount.toString()} should equal ${expectedNative.toString()}`
      ).to.be.true;
    });

    it('should return 0 if estimation is negative', function () {
      const tokenAmount = convertGasToNative(-1, gasPrice);
      expect(tokenAmount.isZero(), 'native amount should be zero').to.be.true;
    });

    it('should return 0 if gas price is negative', function () {
      const tokenAmount = convertGasToNative(estimation, -1);
      expect(tokenAmount.isZero(), 'native amount should be zero').to.be.true;
    });

    it('should return 0 if estimation is zero', function () {
      const tokenAmount = convertGasToNative(0, gasPrice);
      expect(tokenAmount.isZero(), 'native amount should be zero').to.be.true;
    });

    it('should return 0 if gas price is zero', function () {
      const tokenAmount = convertGasToNative(estimation, 0);
      expect(tokenAmount.isZero(), 'native amount should be zero').to.be.true;
    });

    it('should return 0 if estimation is invalid', function () {
      const tokenAmount = convertGasToNative('na', gasPrice);
      expect(tokenAmount.isZero(), 'native amount should be zero').to.be.true;
    });

    it('should return 0 if gas price is invalid', function () {
      const tokenAmount = convertGasToNative(estimation, 'na');
      expect(tokenAmount.isZero(), 'native amount should be zero').to.be.true;
    });
  });
});
 */
