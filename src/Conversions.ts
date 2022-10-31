import BigNumber from 'bignumber.js';
import BN from 'bn.js';
import { toBN } from 'web3-utils';
import ExchangeToken from './definitions/token.type';
import { RelayPricer } from '@rsksmart/rif-relay-client';

export const TARGET_CURRENCY = 'RBTC';

export const RBTC_CHAIN_DECIMALS = 18; // FIXME: should this be configurable?
export const MAX_ETH_GAS_BLOCK_SIZE = 30_000_000;

const relayPricer = new RelayPricer();

/**
 * Multiplies base to power of precision
 * @param precision order of magnitude of the precision i.e. number of zeroes. Defaults to system's native currency precision
 * @param base defaults to base 10
 * @returns BigNumber
 */
export const getPrecision = (
    precision: InputParam = RBTC_CHAIN_DECIMALS,
    base = 10
): BigNumber => new BigNumber(base).pow(precision);

/**
 * Input param that can be converted to BigNumber
 */
type InputParam = BigNumber | string | number;

/**
 * value and precision for the value to be converted to
 */
export type ToPrecisionParams = {
    value: InputParam;
    precision?: number;
};

/**
 * Converts a value to given precision
 * @note large negative powers fail to compute, so direct division is used for negative precision
 * @param ToPrecisionParams
 * @returns BigNumber representation of the calculated precision
 */
export const toPrecision = ({
    value,
    precision
}: ToPrecisionParams): BigNumber => {
    const bigValue = new BigNumber(value);
    const bigPrecision = new BigNumber(precision);
    const precisionMultiplier = getPrecision(bigPrecision.absoluteValue());
    const operation = bigPrecision.isNegative() ? 'dividedBy' : 'multipliedBy';

    return bigValue[operation](precisionMultiplier);
};

/**
 * Converts to BN.js format after changing precision
 * @note it is possible to lose precision for small numbers converting to smaller (negative) precision. This is due to BN.js limitation of rejecting floating point numbers
 * @param ToPrecisionParams
 * @returns BN representation of the calculated precision
 */
export const toBNWithPrecision = ({
    value,
    precision
}: ToPrecisionParams): BN =>
    toBN(toPrecision({ value: value, precision }).toFixed(0));

/**
 * Retreives exchange rate for given token
 * @param token Token object containing token name
 * @returns BigNumber representation of the exchange rate
 */
export const getXRateFor = async ({
    symbol
}: ExchangeToken): Promise<BigNumber> => {
    const exchangeRate = await relayPricer.getExchangeRate(
        symbol,
        TARGET_CURRENCY
    );
    return exchangeRate;
};

/**
 * Converts token amount to native "wei" representation
 * @param token object containing the amount, decimals and exchange rate of the token
 * @returns 'WEI' representation of the token converted to native currency and decimal system
 */
export const toNativeWeiFrom = async ({
    amount,
    decimals = 18,
    xRate
}: ExchangeToken): Promise<BigNumber> => {
    if (!amount || !xRate || amount.isZero() || xRate.isZero()) {
        return new BigNumber(0);
    }
    const amountAsFraction = toPrecision({
        value: amount,
        precision: -decimals
    });

    return toPrecision({
        value: amountAsFraction.multipliedBy(xRate),
        precision: RBTC_CHAIN_DECIMALS
    });
};

/**
 * Converts gas estimation to token amount
 * @param estimation estimation to be converted
 * @param xRate exchange rate of the token
 * @param gasPrice gasPrice
 * @returns 'WEI' representation of the gas converted to token
 */
export const convertGasToToken = (
    estimation: InputParam,
    xRate: InputParam,
    gasPrice: InputParam
): BigNumber => {
    const bigEstimation = new BigNumber(estimation);
    const bigRate = new BigNumber(xRate);
    const bigPrice = new BigNumber(gasPrice);
    if (
        bigEstimation.isNegative() ||
        bigPrice.isNegative() ||
        bigRate.isZero() ||
        bigRate.isNegative()
    ) {
        return new BigNumber(0);
    }
    const total = bigEstimation.multipliedBy(bigPrice);
    return total.dividedBy(bigRate);
};

/**
 * Converts gas estimation to native amount
 * @param estimation estimation to be converted
 * @param gasPrice gasPrice
 * @returns 'WEI' representation of the gas converted to native
 */
export const convertGasToNative = (
    estimation: InputParam,
    gasPrice: InputParam
): BigNumber => {
    const bigEstimation = new BigNumber(estimation);
    const bigPrice = new BigNumber(gasPrice);
    if (bigEstimation.isNegative() || bigPrice.isNegative()) {
        return new BigNumber(0);
    }
    return bigEstimation.multipliedBy(bigPrice);
};
