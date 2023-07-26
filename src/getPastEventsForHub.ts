import type { RelayHub, TypedEvent } from '@rsksmart/rif-relay-contracts';
import type { providers } from 'ethers';
import { BytesLike, deepCopy } from 'ethers/lib/utils';
import log from 'loglevel';
import { getProvider, getRelayHub } from './Utils';
import type {
  DefaultManagerEvent,
  ManagerEvent,
  PastEventOptions,
} from './definitions/event.type';
import retry from 'async-retry';
import { getServerConfig } from './ServerConfigParams';

const DEFAULT_MANAGER_EVENTS: DefaultManagerEvent[] = [
  'RelayServerRegistered',
  'RelayWorkersAdded',
  'TransactionRelayed',
  'TransactionRelayedButRevertedByRecipient',
];

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
  log.debug(
    `getPastEventsForHub: [${fromBlock || 'undefined'}, ${
      toBlock || 'undefined'
    }], (${names.join(',')})`
  );

  const logFilters = await getLogFilters(
    managerAddress,
    { fromBlock, toBlock },
    names
  );

  const logs = await performLogRequests(logFilters);

  return logs.map((log) => logToEvent(log));
}

async function performLogRequests(
  logFilters: providers.Filter[],
  provider: providers.Provider = getProvider()
) {
  const getProviderLogsRequests = (logFilter: providers.Filter) =>
    retry(
      (_, attempt) => {
        log.debug('provider.getLogs, filter', logFilter, 'attempt', attempt);

        return provider.getLogs(logFilter);
      },
      {
        retries: 3,
        minTimeout: 0,
        maxTimeout: 300,
        onRetry: (error) => {
          log.error(error);
        },
      }
    );
  const requests = logFilters.map((logFilter) =>
    getProviderLogsRequests(logFilter)
  );
  const logs = await Promise.allSettled(requests);

  return logs
    .filter((promiseResult) => promiseResult.status === 'fulfilled')
    .map(
      (promiseResult) =>
        (promiseResult as PromiseFulfilledResult<providers.Log[]>).value
    )
    .flat();
}

function getTopicsFromEvents(
  names: ManagerEvent[],
  managerAddress: string,
  relayHub: RelayHub = getRelayHub()
) {
  const filterTopics = names.map((name) =>
    relayHub.interface.encodeFilterTopics(name, [managerAddress])
  );
  const encodedManagerAddress = relayHub.interface._abiCoder.encode(
    ['address'],
    [managerAddress]
  );
  const topicZero = filterTopics.map((topic) => topic[0] as string);
  const topics = [topicZero, [encodedManagerAddress]];

  return topics;
}

async function getLogFilters(
  managerAddress: string,
  { fromBlock, toBlock }: PastEventOptions,
  names: ManagerEvent[] = DEFAULT_MANAGER_EVENTS,
  relayHub = getRelayHub(),
  provider = getProvider()
) {
  const topics = getTopicsFromEvents(names, managerAddress, relayHub);
  log.debug(`getPastEventsForHub - topics`, topics);

  const fromBlockNumber = fromBlock || 1;
  let toBlockNumber;
  if (!toBlock || toBlock === 'latest') {
    toBlockNumber = await provider.getBlockNumber();
    log.debug('getLogFilters: retrieve blockNumber', toBlockNumber);
  } else {
    toBlockNumber = toBlock;
  }
  const commonOptions = {
    address: relayHub.address,
    topics,
  };
  
  const range = toBlockNumber - fromBlockNumber;
  const {
    blockchain: { maxBlockRange },
  } = getServerConfig();
  if (range > maxBlockRange) {

    return splitRange(fromBlockNumber, toBlockNumber, maxBlockRange).map(({from, to}) => ({
      ...commonOptions,
      fromBlock: from,
      toBlock: to
    } as providers.Filter));
  }

  // return one single range, no need to split it
  return [
    {
      ...commonOptions,
      fromBlock,
      toBlock,
    },
  ];
}

const splitRange = (min: number, max: number, desiredRange: number) => {
  const splits = Math.ceil((max - min)/ desiredRange);

  return Array(splits).fill(null).map((_, index) => {
    const from = min + desiredRange * index;
    const to = from + desiredRange > max ? max : from + desiredRange;

    return { from, to};
  })
};