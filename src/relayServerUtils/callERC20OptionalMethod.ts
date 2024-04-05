import type { ERC20 } from '@rsksmart/rif-relay-contracts';
import log from 'loglevel';

export type ERC20OptionalMethod = 'symbol' | 'decimals' | 'name';

export default async function callERC20OptionalMethod<T>(
  tokenInstance: ERC20,
  methodName: ERC20OptionalMethod,
  defaultValue: T
): Promise<T> {
  try {
    return (await tokenInstance[methodName]()) as T;
  } catch (error) {
    log.warn(`ERC20 method ${methodName} failed`, error);

    return defaultValue;
  }
}
