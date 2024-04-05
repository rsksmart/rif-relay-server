import type { BigNumberish } from 'ethers';
import type { PromiseOrValue } from '@rsksmart/rif-relay-contracts';

export function secondsToDate(dateInSeconds: number) {
  return new Date(dateInSeconds * 1000);
}

export async function validateExpirationTime(
  validUntilTime: PromiseOrValue<BigNumberish>,
  requestMinValidSeconds: number
) {
  const validUntilTimeValue = await validUntilTime;
  const secondsNow = Math.round(Date.now() / 1000);
  const expiredInSeconds =
    parseInt(validUntilTimeValue.toString()) - secondsNow;
  if (expiredInSeconds < requestMinValidSeconds) {
    const expirationDate = secondsToDate(
      parseInt(validUntilTimeValue.toString())
    );
    throw new Error(
      `Request expired (or too close): expiration date received "${expirationDate.toUTCString()}" is expected to be greater than or equal to "${secondsToDate(
        secondsNow + requestMinValidSeconds
      ).toUTCString()}"`
    );
  }
}

export default validateExpirationTime;
