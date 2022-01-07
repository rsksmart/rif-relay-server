"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGas = exports.getRBTCWeiFromRifWei = void 0;
const web3_utils_1 = require("web3-utils");
/**
 * TODO: Hard-coded values: for testing purposes only!
 This is specific for the tRIF token.
 */
function getRBTCWeiFromRifWei(trifWei) {
    const tRifPriceInRBTC = 0.000005739;
    const rifTokenDecimals = 18;
    const costInTrif = parseFloat(web3_utils_1.fromWei(trifWei));
    const costInRBTC = costInTrif * tRifPriceInRBTC;
    const costInRBTCFixed = costInRBTC.toFixed(rifTokenDecimals);
    const costInWei = web3_utils_1.toWei(costInRBTCFixed);
    return web3_utils_1.toBN(costInWei);
}
exports.getRBTCWeiFromRifWei = getRBTCWeiFromRifWei;
function getGas(cost, gasPrice) {
    return cost.div(gasPrice);
}
exports.getGas = getGas;
//# sourceMappingURL=Conversions.js.map