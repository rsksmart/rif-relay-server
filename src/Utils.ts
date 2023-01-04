import { getDefaultProvider, providers, utils } from 'ethers';
import chalk from 'chalk';
import config from 'config';
import ow from 'ow';
import {
  TypedEvent,
  IRelayHub,
  RelayHub__factory,
  RelayHub,
} from '@rsksmart/rif-relay-contracts';
import type {
  DefaultManagerEvent,
  ManagerEvent,
  ManagerEventParameters,
  PastEventOptions,
} from './definitions/event.type';
import type { AppConfig } from './ServerConfigParams';

const DEFAULT_MANAGER_EVENTS: DefaultManagerEvent[] = [
  'RelayServerRegistered',
  'RelayWorkersAdded',
  'TransactionRelayed',
  'TransactionRelayedButRevertedByRecipient',
];

const CONFIG_CONTRACTS = 'contracts';
const CONFIG_BLOCKCHAIN = 'blockchain';
const CONFIG_APP = 'app';
const CONFIG_RELAY_HUB_ADDRESS = 'relayHubAddress';
const CONFIG_RSK_URL = 'rskNodeUrl';

const getConfiguredRelayHubAddress = () =>
  config.get<string>(`${CONFIG_CONTRACTS}.${CONFIG_RELAY_HUB_ADDRESS}`);

const getRelayHub = (
  provider = getProvider(),
  relayHubAddress = getConfiguredRelayHubAddress()
): RelayHub => RelayHub__factory.connect(relayHubAddress, provider);

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

export async function getPastEventsForHub(
  parameters: ManagerEventParameters,
  { fromBlock, toBlock }: PastEventOptions,
  names: ManagerEvent[] = DEFAULT_MANAGER_EVENTS
): Promise<Array<TypedEvent>> {
  const relayHub = getRelayHub();

  const eventFilters = await Promise.all(
    names.map((name) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const filter = relayHub.filters[name](...parameters);

      return relayHub.queryFilter(filter, fromBlock, toBlock);
    })
  );

  return eventFilters.flat();
}

export async function getRelayInfo(
  relayManagers: Set<string>
): Promise<IRelayHub.RelayManagerDataStruct[]> {
  const relayHub = getRelayHub();

  const managers: string[] = Array.from(relayManagers);
  const contractCalls: Array<Promise<IRelayHub.RelayManagerDataStruct>> =
    managers.map((managerAddress) => relayHub.getRelayInfo(managerAddress));

  return await Promise.all(contractCalls);
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
  managerAddress: string
): boolean {
  const { url, port } = config.get<AppConfig>(CONFIG_APP);

  const portIncluded: boolean = url.indexOf(':') > 0;

  if (relayData) {
    const manager = relayData.manager as string;

    return (
      isSameAddress(manager, managerAddress) &&
      relayData.url.toString() ===
        url.toString() +
          (!portIncluded && port > 0 ? ':' + port.toString() : '')
    );
  }

  return false;
}

export async function isContractDeployed(address: string): Promise<boolean> {
  const provider = getProvider();

  const code = await provider.getCode(address);

  // Check added for RSKJ: when the contract does not exist in RSKJ it replies to the getCode call with 0x00
  return code !== '0x' && code !== '0x00';
}

export function getProvider(): providers.Provider {
  return getDefaultProvider(
    config.get<string>(`${CONFIG_BLOCKCHAIN}.${CONFIG_RSK_URL}`)
  );
}

export const deployTransactionRequestShape = {
  relayRequest: {
    request: {
      relayHub: ow.string,
      from: ow.string,
      to: ow.string,
      value: ow.string,
      nonce: ow.string,
      data: ow.string,
      tokenContract: ow.string,
      tokenAmount: ow.string,
      tokenGas: ow.string,
      recoverer: ow.string,
      index: ow.string,
    },
    relayData: {
      gasPrice: ow.string,
      relayWorker: ow.string,
      callForwarder: ow.string,
      callVerifier: ow.string,
    },
  },
  metadata: {
    relayHubAddress: ow.string,
    relayMaxNonce: ow.number,
    signature: ow.string,
  },
};

export const relayTransactionRequestShape = {
  relayRequest: {
    request: {
      relayHub: ow.string,
      from: ow.string,
      to: ow.string,
      value: ow.string,
      gas: ow.string,
      nonce: ow.string,
      data: ow.string,
      tokenContract: ow.string,
      tokenAmount: ow.string,
      tokenGas: ow.string,
    },
    relayData: {
      gasPrice: ow.string,
      relayWorker: ow.string,
      callForwarder: ow.string,
      callVerifier: ow.string,
    },
  },
  metadata: {
    relayHubAddress: ow.string,
    relayMaxNonce: ow.number,
    signature: ow.string,
  },
};
