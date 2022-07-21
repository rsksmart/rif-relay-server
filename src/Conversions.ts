import { fromWei, toBN, toWei } from 'web3-utils';
/**
 * FIXME: Hard-coded values: for testing purposes only!
 This is specific for the tRIF token.
 */
// FIXME: generalise function
// @note Also I suggest using BigNumber.js instead of BN. It supports floating point numbers, has better precision and is the lib that ethers uses, so it would be better to work across the two frameworks. An additional bonus is that it allows you to do BigNumber.from(your_big_number, decimals), which makes conversions super easy and doesn't rely on Map<string,string> that is Map<ether_fraction_name, fraction_size_in_wei>
// @note This should probably be in the common library?
export function getRBTCWeiFromRifWei(trifWei: BN): BN {
    const tRifPriceInRBTC = 0.000005739; // FIXME: should be BN
    const rifTokenDecimals = 18;

    const costInTrif = parseFloat(fromWei(trifWei)); // FIXME: this is performed with potentially wrong decimals (unit defaults to 'ether', see unitMap in ethjs-unit/lib)
    const costInRBTC = costInTrif * tRifPriceInRBTC; // FIXME: float is not big enough to perfom calculations upon
    const costInRBTCFixed = costInRBTC.toFixed(rifTokenDecimals);
    const costInWei = toWei(costInRBTCFixed);
    return toBN(costInWei);
}

export function getGas(cost: BN, gasPrice: BN) {
    return cost.div(gasPrice);
}
