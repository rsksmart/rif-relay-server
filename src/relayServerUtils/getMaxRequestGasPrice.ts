import { BigNumber, BigNumberish } from 'ethers';
import { applyFactor } from '../Conversions';

export type MaxRequestGasPriceConfig = {
  maxRequestGasPriceFactor: number;
  maxRequestGasPriceFloor: BigNumberish;
};

/**
 * The highest gasPrice the server sends a transaction at.
 *
 * The node rejects a transaction priced above its gas price cap (80 times the
 * minimum gas price on RSK), but eth_call and eth_estimateGas do not, so such
 * a transaction would pass every other check and the nonce it takes would
 * never be mined. The maximum therefore follows the node's gasPrice, with an
 * absolute floor so that clients using a fixed gasPrice (0.06 gwei by default
 * in rif-relay-client) keep being accepted when the node's gasPrice falls.
 * @param nodeGasPrice the node's current gasPrice
 * @param config the blockchain configuration
 * @returns the maximum gasPrice, in wei
 */
export function getMaxRequestGasPrice(
  nodeGasPrice: BigNumberish,
  {
    maxRequestGasPriceFactor,
    maxRequestGasPriceFloor,
  }: MaxRequestGasPriceConfig
): BigNumber {
  const maxGasPrice = applyFactor(nodeGasPrice, maxRequestGasPriceFactor);
  const floor = BigNumber.from(maxRequestGasPriceFloor);

  return maxGasPrice.gt(floor) ? maxGasPrice : floor;
}

export default getMaxRequestGasPrice;
