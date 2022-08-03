import BigNumber from 'bignumber.js';
import BN from 'bn.js';
import { toBN } from 'web3-utils';
import Token from './definitions/token.type';

export const RBTC_IN_RIF = '0.000005739'; // FIXME: get rid of this nonsense

export const RBTC_CHAIN_DECIMALS = 18; // FIXME: should this be configurable?
export const MAX_ETH_GAS_BLOCK_SIZE = 30_000_000;

export const SUPPORTED_TOKENS: readonly Token[] = [
    {
        name: 'tRIF',
        decimals: 18,
        contractAddress: '0xMAKE_ME_A_HAPPY_TOKEN_PLEASE'
    }
]; // FIXME: make me configurable

/**
 * Multiplies base to power of precision
 * @param precision order of magnitude of the precision i.e. number of zeroes. Defaults to system's native currency precision
 * @param base defaults to base 10
 * @returns BigNumber
 */
export const getPrecision = (
    precision: number = RBTC_CHAIN_DECIMALS,
    base = 10
): BigNumber => new BigNumber(base).pow(precision);

/**
 * value and precision for the value to be converted to
 */
export type ToPrecisionParams = {
    value: BigNumber | string | number;
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
}: ToPrecisionParams): BigNumber =>
    new BigNumber(value)[
        new BigNumber(precision).isNegative() ? 'dividedBy' : 'multipliedBy'
    ](getPrecision(Math.abs(precision)));

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
 * @param token Token object containing token name (TODO: other req params for price feeders)
 * @returns BigNumber representation of the exchange rate
 */
export const getXRateFor = async ({ name }: Token): Promise<BigNumber> =>
    new Promise((resolve) => {
        resolve(name && new BigNumber(RBTC_IN_RIF)); // FIXME: implement: use price feeder
    });

/**
 * Converts token amount to native "wei" representation
 * @param token object containing the amount, decimals and exchange rate of the token
 * @returns 'WEI' representation of the token converted to native currency and decimal system
 */
export const toNativeWeiFrom = async ({
    amount,
    decimals,
    xRate
}: Token): Promise<BigNumber> => {
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
