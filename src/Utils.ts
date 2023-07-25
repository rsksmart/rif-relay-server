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
  PastEventOptions,
} from './definitions/event.type';
import { getServerConfig } from './ServerConfigParams';
import { BytesLike, deepCopy, getAddress } from 'ethers/lib/utils';
import log from 'loglevel';

const DEFAULT_MANAGER_EVENTS: DefaultManagerEvent[] = [
  'RelayServerRegistered',
  'RelayWorkersAdded',
  'TransactionRelayed',
  'TransactionRelayedButRevertedByRecipient',
];

const CONFIG_CONTRACTS = 'contracts';
const CONFIG_BLOCKCHAIN = 'blockchain';
const CONFIG_RELAY_HUB_ADDRESS = 'relayHubAddress';
const CONFIG_RSK_URL = 'rskNodeUrl';
// TODO: do we want to configure this param?
const MAX_BLOCK_RANGE_LENGTH = 1000;

const getConfiguredRelayHubAddress = () =>
  config.get<string>(`${CONFIG_CONTRACTS}.${CONFIG_RELAY_HUB_ADDRESS}`);

export const getRelayHub = (
  relayHubAddress = getConfiguredRelayHubAddress(),
  provider = getProvider()
): RelayHub => RelayHub__factory.connect(relayHubAddress, provider);

export function isSameAddress(address1: string, address2: string): boolean {
  return getAddress(address1) === getAddress(address2);
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

const logToEvent = (
  log: providers.Log,
  relayHub = getRelayHub(),
  provider = getProvider()
) => {
  const event = <TypedEvent>deepCopy(log);
  event.removeListener = () => {
    return;
  };
  event.getBlock = () => provider.getBlock(log.blockHash);
  event.getTransaction = () => provider.getTransaction(log.transactionHash);
  event.getTransactionReceipt = () =>
    provider.getTransactionReceipt(log.transactionHash);

  const parsedLog = relayHub.interface.parseLog(log);
  event.event = parsedLog.name;
  event.eventSignature = parsedLog.signature;
  event.decode = (data: BytesLike, topics?: Array<string>) =>
    relayHub.interface.decodeEventLog(parsedLog.eventFragment, data, topics);
  event.args = parsedLog.args;
  // decodeError is missing here

  return event;
};

export async function getPastEventsForHub(
  managerAddress: string,
  { fromBlock, toBlock }: PastEventOptions,
  names: ManagerEvent[] = DEFAULT_MANAGER_EVENTS
): Promise<Array<TypedEvent>> {
  const relayHub = getRelayHub();

  log.debug(
    `getPastEventsForHub: [${fromBlock || 'undefined'}, ${
      toBlock || 'undefined'
    }], (${names.join(',')})`
  );

  const provider = getProvider();

  const filterTopics = names.map((name) =>
    relayHub.interface.encodeFilterTopics(name, [managerAddress])
  );
  const encodedManagerAddress = relayHub.interface._abiCoder.encode(
    ['address'],
    [managerAddress]
  );
  const topicZero = filterTopics.map((topic) => topic[0] as string);
  const topics = [topicZero, [encodedManagerAddress]];
  log.debug(`getPastEventsForHub - topics`, topics);

  // TODO: We need to change this method to handle timeout exceptions
  const fromBlockNumber = fromBlock || 1;
  let toBlockNumber = 0;
  if ( toBlock === 'latest') {
    toBlockNumber = await provider.getBlockNumber();
  }
  const commonOptions = {
    address: relayHub.address,
    topics,
  }
  const range = toBlockNumber - fromBlockNumber;
  if ( range > MAX_BLOCK_RANGE_LENGTH) {
    const totalRequests = Math.ceil(range / MAX_BLOCK_RANGE_LENGTH); 
    // to
    const requestOptions = Array(totalRequests).fill(commonOptions).map((opt, index) => {
      const fromBlock = fromBlockNumber + (MAX_BLOCK_RANGE_LENGTH * index);
      const toBlock = (fromBlock + MAX_BLOCK_RANGE_LENGTH) > fromBlockNumber ? fromBlockNumber : (fromBlock + MAX_BLOCK_RANGE_LENGTH);

      return {
        ...opt,
        fromBlock,
        toBlock
      } as providers.Filter;
    });
  }
  
  const events = (
    await provider.getLogs({
      address: relayHub.address,
      fromBlock,
      toBlock,
      topics,
    })
  ).map((log) => logToEvent(log, relayHub, provider));

  return events;
}

export async function getPastEventsForHubOld(
  managerAddress: string,
  { fromBlock, toBlock }: PastEventOptions,
  names: ManagerEvent[] = DEFAULT_MANAGER_EVENTS
): Promise<Array<TypedEvent>> {
  // TODO: We need to change this method to handle timeout exceptions
  const relayHub = getRelayHub();

  log.trace(
    `getPastEventsForHub: [${fromBlock || 'undefined'}, ${
      toBlock || 'undefined'
    }], (${names.join(',')})`
  );

  const filterTopics = names.map((name) =>
    relayHub.interface.encodeFilterTopics(name, [managerAddress])
  );
  const encodedManagerAddress = relayHub.interface._abiCoder.encode(
    ['address'],
    [managerAddress]
  );
  const topicZero = filterTopics.map((topic) => topic[0] as string);
  const topics = [topicZero, [encodedManagerAddress]];
  log.debug(`getPastEventsForHub - filterTopics`, topics);

  // TODO: here we perform one request per event type, while we could do one single request
  const eventFilters = await Promise.all(
    names.map((name) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      // FIXME: how is it possible to filter different events using the same parameters???
      const filter = relayHub.filters[name](...[managerAddress]);

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
  if (relayData) {
    const manager = relayData.manager.toString();
    const {
      app: { url: serverUrl },
    } = getServerConfig();

    return (
      isSameAddress(manager, managerAddress) &&
      relayData.url.toString() === serverUrl
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

//TODO improve the validating and type handling
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
      index: ow.number,
      validUntilTime: ow.number,
    },
    relayData: {
      gasPrice: ow.string,
      feesReceiver: ow.string,
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

//TODO improve the validating and type handling
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
      validUntilTime: ow.number,
    },
    relayData: {
      gasPrice: ow.string,
      feesReceiver: ow.string,
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
