import BigNumber from 'bignumber.js';
import { fromWei, toBN, toWei } from 'web3-utils';

export const RBTC_CHAIN_DECIMALS = 18; // FIXME: should this be configurable?
export const MAX_ETH_GAS_BLOCK_SIZE = 30_000_000;

/**
 * FIXME: Hard-coded values: for testing purposes only!
 This is specific for the tRIF token.
 */
// FIXME: generalise function
// @note Also I suggest using @ethersproject/bignumber instead of BN. It is an extension on BN (intersecion with web3) that ethers uses, so it would be better to work across the two frameworks. An additional bonus is that it allows you to do BigNumber.from(your_big_number, decimals), which makes conversions super easy and doesn't rely on Map<string,string> that is Map<ether_fraction_name, fraction_size_in_wei>
// @note This should probably be in the common library?
export function getRBTCWeiFromRifWei(trifWei: BN): BN {
  const tRifPriceInRBTC = 0.000005739; // FIXME: should be BN
  const rifTokenDecimals = 18;

  const costInTrif = parseFloat(fromWei(trifWei)); // FIXME: this is performed with potentially wrong decimals (unit defaults to 'ether', see unitMap in ethjs-unit/lib)
  const costInRBTC = costInTrif * tRifPriceInRBTC; // FIXME: float is not big enough to perfom calculations upon
  const costInRBTCFixed = costInRBTC.toFixed(rifTokenDecimals);
  const costInWei: string = toWei(costInRBTCFixed);
  return toBN(costInWei);
}

// FIXME: getGasAmount?
export function getGas(cost: BN, gasPrice: BN): BN {
  return cost.div(gasPrice);
}

export const getPrecision = (precision?: number): BigNumber => new BigNumber(10).pow(precision ?? RBTC_CHAIN_DECIMALS);

export const normaliseFraction = (
{ fraction, precision }: { fraction: BigNumber | string | number; precision?: number; }): BigNumber => getPrecision(precision).multipliedBy(fraction).integerValue(BigNumber.ROUND_CEIL);

export const fractionToBN = (
  { fraction, precision }: { fraction: BigNumber | string | number; precision?: number; }): BN => toBN(normaliseFraction({ fraction, precision }).toString());
