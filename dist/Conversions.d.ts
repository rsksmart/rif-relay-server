/// <reference types="@openeth/truffle-typings" />
/// <reference types="bn.js" />
/**
 * TODO: Hard-coded values: for testing purposes only!
 This is specific for the tRIF token.
 */
export declare function getRBTCWeiFromRifWei(trifWei: BN): BN;
export declare function getGas(cost: BN, gasPrice: BN): import("bn.js");
