import BigNumber from 'bignumber.js';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import Sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
    getXRateFor,
    RBTC_IN_RIF,
    toNativeWeiFrom,
    toPrecision
} from '../../src/Conversions';
import Token from '../../src/definitions/token.type';

use(sinonChai);
use(chaiAsPromised);

describe('Conversions', () => {
    afterEach(() => {
        Sinon.restore();
    });

    describe('getXRateFor', async () => {
        it('should return exchange rate of given token (from test constants as price feeder needs to be implemented)', async () => {
            const expectedXRate: BigNumber = new BigNumber(RBTC_IN_RIF);
            const token: Token = {
                contractAddress: '',
                decimals: 18,
                name: 'tRIF'
            };

            const actualXRate: BigNumber = await getXRateFor(token);

            expect(
                actualXRate.isEqualTo(expectedXRate),
                `${actualXRate} should equal ${expectedXRate}`
            ).to.be.true;
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

            const token: Token = {
                contractAddress: '',
                decimals: 18,
                name: 'tRIF',
                amount: tokenAmount,
                xRate: exchangeRate
            };

            const actualCurrencyAmount = await toNativeWeiFrom(token);

            expect(
                actualCurrencyAmount.eq(expectedCurrencyAmount),
                `${actualCurrencyAmount.toString()} should equal ${expectedCurrencyAmount.toString()}`
            ).to.be.true;
        });

        it('should convert between different decimal systems', async () => {
            const erc20Decimals = 22;
            const exchangeRate: BigNumber = new BigNumber(RBTC_IN_RIF);
            const tokenAmount: BigNumber = new BigNumber(
                '3'.padEnd(erc20Decimals, '0')
            );

            const nativeWeiDecimals = 18;

            const token: Token = {
                contractAddress: '',
                decimals: erc20Decimals,
                name: 'tRIF_22',
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
