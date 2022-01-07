import { toBN, fromWei, toWei } from 'web3-utils';
/**
 * TODO: Hard-coded values: for testing purposes only!
 This is specific for the tRIF token.
 */
 export function getRBTCWeiFromRifWei(trifWei: BN): BN {
    const tRifPriceInRBTC = 0.000005739;
    const rifTokenDecimals = 18;

    const costInTrif = parseFloat(fromWei(trifWei));
    const costInRBTC = costInTrif * tRifPriceInRBTC;
    const costInRBTCFixed = costInRBTC.toFixed(rifTokenDecimals);
    const costInWei = toWei(costInRBTCFixed);
    return toBN(costInWei);
}

export function getGas(cost: BN, gasPrice: BN) {
    return cost.div(gasPrice);
}