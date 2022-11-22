import { utils, BigNumber } from 'ethers';
import type { BigNumberish } from 'ethers';
import chalk from 'chalk';
import type { TypedEvent, IRelayHub } from '@rsksmart/rif-relay-contracts';
import type { AppConfig } from './ServerConfigParams';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import { ESTIMATED_GAS_CORRECTION_FACTOR } from '@rsksmart/rif-relay-common';
import { parseToBigNumber } from './Conversions';

export function isSameAddress(address1: string, address2: string): boolean {
  return address1.toLowerCase() === address2.toLowerCase();
}

export function validateAddress(
  address: string,
  exceptionTitle = 'invalid address:'
): void {
  if (!utils.isAddress(address)) {
    throw new Error(`${address} ${exceptionTitle}`);
  }
}

export async function sleep(ms: number): Promise<void> {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min) + min);
}

export function boolString(bool: boolean): string {
  return bool ? chalk.green('good'.padEnd(14)) : chalk.red('wrong'.padEnd(14));
}

export function getLatestEventData(
  events: Array<TypedEvent>
): TypedEvent | undefined {
  if (events.length === 0) {
    return;
  }
  const eventDataSorted = events.sort((a: TypedEvent, b: TypedEvent) => {
    if (a.blockNumber === b.blockNumber) {
      return b.transactionIndex - a.transactionIndex;
    }

    return b.blockNumber - a.blockNumber;
  });

  return eventDataSorted[0];
}

export function isSecondEventLater(a: TypedEvent, b: TypedEvent): boolean {
  if (a.blockNumber === b.blockNumber) {
    return b.transactionIndex > a.transactionIndex;
  }

  return b.blockNumber > a.blockNumber;
}

export function isRegistrationValid(
  relayData: IRelayHub.RelayManagerDataStruct | undefined,
  config: AppConfig,
  managerAddress: string
): boolean {
  const portIncluded: boolean = config.url.indexOf(':') > 0;

  if (relayData) {
    const manager = relayData.manager as string;

    return (
      isSameAddress(manager, managerAddress) &&
      relayData.url.toString() ===
        config.url.toString() +
          (!portIncluded && config.port > 0 ? ':' + config.port.toString() : '')
    );
  }

  return false;
}

/**
 * @returns maximum possible gas consumption by this relay call
 * Note that not using the linear fit would result in an Inadequate amount of gas
 * You can add another kind of estimation (a hardcoded value for example) in that "else" statement
 * if you don't then use this function with usingLinearFit = true
 */
export function estimateMaxPossibleRelayCallWithLinearFit(
  relayCallGasLimit: BigNumberish,
  tokenPaymentGas: BigNumberish,
  addCushion = false
): BigNumber {
  const cushion = addCushion ? ESTIMATED_GAS_CORRECTION_FACTOR : 1.0;

  const bigRelay = BigNumberJs(relayCallGasLimit.toString());
  const bigTokenPayment = BigNumberJs(tokenPaymentGas.toString());

  let estimatedCost: BigNumberJs;

  if (bigTokenPayment.isZero()) {
    // Subsidized case
    // y = a0 + a1 * x = 85090.977 + 1.067 * x
    const a0 = BigNumberJs('85090.977');
    const a1 = BigNumberJs('1.067');
    estimatedCost = a1.multipliedBy(bigRelay).plus(a0);
  } else {
    // y = a0 + a1 * x = 72530.9611 + 1.1114 * x
    const a0 = BigNumberJs('72530.9611');
    const a1 = BigNumberJs('1.1114');
    estimatedCost = a1.multipliedBy(bigRelay.plus(bigTokenPayment)).plus(a0);
  }

  const costWithCushion = estimatedCost
    .multipliedBy(cushion.toString())
    .decimalPlaces(0, BigNumberJs.ROUND_CEIL);

  return parseToBigNumber(costWithCushion);
}
