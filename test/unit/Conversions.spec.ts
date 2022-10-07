import { RelayPricer } from '@rsksmart/rif-relay-client';
import BigNumber from 'bignumber.js';
import { expect, use, assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import Sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
    getXRateFor,
    toNativeWeiFrom,
    toPrecision
} from '../../src/Conversions';
import ExchangeToken from '../../src/definitions/token.type';

use(sinonChai);
use(chaiAsPromised);

describe('Conversions', () => {
    const xRateRifRbtc = BigNumber('0.00000332344907316948');

    afterEach(() => {
        Sinon.restore();
    });

    describe('getXRateFor', async () => {
        it('should return exchange rate of given token', async () => {
            Sinon.stub(RelayPricer.prototype, 'getExchangeRate').returns(
                Promise.resolve(xRateRifRbtc)
            );
            const expectedXRate: BigNumber = xRateRifRbtc;
            const token: ExchangeToken = {
                contractAddress: '',
                decimals: 18,
                name: 'tRIF',
                symbol: 'RIF'
            };

            const actualXRate: BigNumber = await getXRateFor(token);

            expect(
                actualXRate.isEqualTo(expectedXRate),
                `${actualXRate} should equal ${expectedXRate}`
            ).to.be.true;
        });

        it('should fail if token is null', async () => {
            await assert.isRejected(
                getXRateFor(null),
                "Cannot destructure property 'symbol' of 'object null' as it is null."
            );
        });

        it('should fail if token is does not have symbol', async () => {
            const error = Error(
                'There is no available API for token undefined'
            );
            Sinon.stub(RelayPricer.prototype, 'getExchangeRate').returns(
                Promise.reject(error)
            );
            const token: ExchangeToken = {
                contractAddress: '',
                decimals: 18,
                name: ''
            };
            await assert.isRejected(getXRateFor(token), error.message);
        });

        it('should fail if token does not exist', async () => {
            const error = Error('There is no available API for token NA');
            Sinon.stub(RelayPricer.prototype, 'getExchangeRate').returns(
                Promise.reject(error)
            );
            const token: ExchangeToken = {
                contractAddress: '',
                decimals: 18,
                name: 'NA',
                symbol: 'NA'
            };
            await assert.isRejected(getXRateFor(token), error.message);
        });
    });

    describe('toNativeWeiFrom', () => {
        it('should convert given token amount to given currency', async () => {
            const expectedCurrencyAmount: BigNumber = new BigNumber(
                3
            ).multipliedBy(new BigNumber(10).pow(13)); // 3e13 'wei' -> 0.00003 rbtc
            const exchangeRate: BigNumber = new BigNumber(0.00016);
            const tokenAmount: BigNumber =
                expectedCurrencyAmount.dividedBy(exchangeRate);

            const token: ExchangeToken = {
                contractAddress: '',
                decimals: 18,
                name: 'tRIF',
                amount: tokenAmount,
                xRate: exchangeRate,
                symbol: 'RIF'
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
                contractAddress: '',
                decimals: erc20Decimals,
                name: 'tRIF_22',
                symbol: 'RIF_22',
                amount: tokenAmount,
                xRate: exchangeRate
            };

            const tokenAsFraction = toPrecision({
                value: token.amount,
                precision: -token.decimals
            });

            const tokenInNativeWei = toPrecision({
                value: tokenAsFraction.multipliedBy(exchangeRate),
                precision: nativeWeiDecimals
            });

            const expectedWeiAmount = tokenInNativeWei;

            const actualCurrencyAmount = await toNativeWeiFrom(token);

            expect(
                actualCurrencyAmount.eq(expectedWeiAmount),
                `${actualCurrencyAmount.toString()} should equal ${expectedWeiAmount.toString()}`
            ).to.be.true;
        });
    });
});
