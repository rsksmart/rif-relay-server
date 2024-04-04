import type { ERC20 } from '@rsksmart/rif-relay-contracts';
import callERC20OptionalMethod from './callERC20OptionalMethod';

export async function callERC20Decimals(
  tokenInstance: ERC20,
  defaultValue = 18
) {
  return callERC20OptionalMethod(tokenInstance, 'decimals', defaultValue);
}

export default callERC20Decimals;
