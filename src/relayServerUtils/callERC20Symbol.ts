import type { ERC20 } from '@rsksmart/rif-relay-contracts';
import callERC20OptionalMethod from './callERC20OptionalMethod';

export async function callERC20Symbol(
  tokenInstance: ERC20,
  defaultValue = 'ERC20'
) {
  return callERC20OptionalMethod(tokenInstance, 'symbol', defaultValue);
}

export default callERC20Symbol;
