import type { RelayHub } from '@rsksmart/rif-relay-contracts';
import { expect } from 'chai';
import config from 'config';
import type { providers } from 'ethers';
import type { ServerConfigParams } from 'src';
import {
  getLogFilters,
  getTopicsFromEvents,
  performLogRequests,
  splitRange,
} from 'src/getPastEventsForHub';

describe('getPastEventsFromHub', function () {
  describe('splitRange', function () {
    it('should not split a range if the desired range is greater than the range', function () {
      const min = 0;
      const max = 10;
      const splits = splitRange(min, max, 20);
      const expectedSplits = [{ from: min, to: max }];
      expect(splits).to.be.eql(expectedSplits);
    });

    it('should not split a range if the desired range is equal to the range', function () {
      const min = 1;
      const max = 10;
      const splits = splitRange(min, max, 10);
      const expectedSplits = [{ from: min, to: max }];
      expect(splits).to.be.eql(expectedSplits);
    });

    it('should split a range if the desired range is less than the range', function () {
      const min = 0;
      const max = 10;
      const expectedSplits = [
        { from: 0, to: 2 },
        { from: 2, to: 4 },
        { from: 4, to: 6 },
        { from: 6, to: 8 },
        { from: 8, to: 10 },
      ];
      const splits = splitRange(min, max, 2);
      expect(splits).to.be.eql(expectedSplits);
    });

    it('should split a range so that the last split does not exceed the max', function () {
      const min = 0;
      const max = 9;
      const expectedSplits = [
        { from: 0, to: 2 },
        { from: 2, to: 4 },
        { from: 4, to: 6 },
        { from: 6, to: 8 },
        { from: 8, to: 9 },
      ];
      const splits = splitRange(min, max, 2);
      expect(splits).to.be.eql(expectedSplits);
    });
  });

  describe('getTopicsFrom events', function () {
    it('should create log topics if one event is specified', function () {
      const encodedTopic = 'encodedTopic';
      const encodedAddress = 'encodedAddress';
      const stubRelayHub = {
        interface: {
          getEventTopic: () => encodedTopic,
          _abiCoder: {
            encode: () => encodedAddress,
          },
        },
      } as unknown as RelayHub;
      const topics = getTopicsFromEvents(
        ['RelayServerRegistered'],
        '0x123abc',
        stubRelayHub
      );
      const expectedTopics = [[encodedTopic], [encodedAddress]];
      // first argument is the list of events, while second argument is the manager address
      expect(topics).to.be.eql(expectedTopics);
    });

    it('should create log topics if many events are specified', function () {
      const encodedTopic = 'encodedTopic';
      const encodedAddress = 'encodedAddress';
      const stubRelayHub = {
        interface: {
          getEventTopic: (name: string) => `encodedTopic-${name}`,
          _abiCoder: {
            encode: () => encodedAddress,
          },
        },
      } as unknown as RelayHub;
      const topics = getTopicsFromEvents(
        ['RelayServerRegistered', 'RelayWorkersAdded', 'TransactionRelayed'],
        '0x123abc',
        stubRelayHub
      );
      const expectedTopics = [
        [
          `${encodedTopic}-RelayServerRegistered`,
          `${encodedTopic}-RelayWorkersAdded`,
          `${encodedTopic}-TransactionRelayed`,
        ],
        [encodedAddress],
      ];
      // first argument is the list of events, while second argument is the manager address
      expect(topics).to.be.eql(expectedTopics);
    });
  });

  describe('getLogFilters', function () {
    let originalConfig: ServerConfigParams;

    before(function () {
      originalConfig = config.util.toObject(config) as ServerConfigParams;
    });

    afterEach(function () {
      config.util.extendDeep(config, originalConfig);
    });
    it('should create multiple log filters with one event', async function () {
      config.util.extendDeep(config, { blockchain: { maxBlockRange: 5 } });
      const relayHubAddress = '0x456efc';
      const expectedEncodedAddress = 'encodedAddress';
      const stubRelayHub = {
        interface: {
          getEventTopic: (name: string) => `encodedTopic-${name}`,
          _abiCoder: {
            encode: () => expectedEncodedAddress,
          },
        },
        address: relayHubAddress,
      } as unknown as RelayHub;
      const expectedEncodedTopic = 'encodedTopic-RelayServerRegistered';
      const managerAddress = '0x123abc';
      const logFilters = await getLogFilters(
        managerAddress,
        { fromBlock: 1, toBlock: 10 },
        ['RelayServerRegistered'],
        stubRelayHub
      );

      const expectedLogFilters = [
        {
          address: '0x456efc',
          topics: [[expectedEncodedTopic], [expectedEncodedAddress]],
          fromBlock: 1,
          toBlock: 6,
        },
        {
          address: '0x456efc',
          topics: [[expectedEncodedTopic], [expectedEncodedAddress]],
          fromBlock: 6,
          toBlock: 10,
        },
      ];

      expect(logFilters).to.be.eql(expectedLogFilters);
    });

    it('should create multiple log filters with multiple events', async function () {
      config.util.extendDeep(config, { blockchain: { maxBlockRange: 5 } });
      const relayHubAddress = '0x456efc';
      const expectedEncodedAddress = 'encodedAddress';
      const stubRelayHub = {
        interface: {
          getEventTopic: (name: string) => `encodedTopic-${name}`,
          _abiCoder: {
            encode: () => expectedEncodedAddress,
          },
        },
        address: relayHubAddress,
      } as unknown as RelayHub;
      const expectedEncodedTopic = [
        'encodedTopic-RelayServerRegistered',
        'encodedTopic-RelayWorkersAdded',
        'encodedTopic-TransactionRelayed',
      ];
      const managerAddress = '0x123abc';
      const logFilters = await getLogFilters(
        managerAddress,
        { fromBlock: 1, toBlock: 10 },
        ['RelayServerRegistered', 'RelayWorkersAdded', 'TransactionRelayed'],
        stubRelayHub
      );

      const expectedLogFilters = [
        {
          address: '0x456efc',
          topics: [expectedEncodedTopic, [expectedEncodedAddress]],
          fromBlock: 1,
          toBlock: 6,
        },
        {
          address: '0x456efc',
          topics: [expectedEncodedTopic, [expectedEncodedAddress]],
          fromBlock: 6,
          toBlock: 10,
        },
      ];

      expect(logFilters).to.be.eql(expectedLogFilters);
    });

    it('should create one log filter if the block range is lower than the configured one', async function () {
      config.util.extendDeep(config, { blockchain: { maxBlockRange: 10 } });
      const relayHubAddress = '0x456efc';
      const expectedEncodedAddress = 'encodedAddress';
      const stubRelayHub = {
        interface: {
          getEventTopic: (name: string) => `encodedTopic-${name}`,
          _abiCoder: {
            encode: () => expectedEncodedAddress,
          },
        },
        address: relayHubAddress,
      } as unknown as RelayHub;
      const expectedEncodedTopic = [
        'encodedTopic-RelayServerRegistered',
        'encodedTopic-RelayWorkersAdded',
        'encodedTopic-TransactionRelayed',
      ];
      const managerAddress = '0x123abc';
      const logFilters = await getLogFilters(
        managerAddress,
        { fromBlock: 1, toBlock: 10 },
        ['RelayServerRegistered', 'RelayWorkersAdded', 'TransactionRelayed'],
        stubRelayHub
      );

      const expectedLogFilters = [
        {
          address: '0x456efc',
          topics: [expectedEncodedTopic, [expectedEncodedAddress]],
          fromBlock: 1,
          toBlock: 10,
        },
      ];

      expect(logFilters).to.be.eql(expectedLogFilters);
    });
  });

  describe('performLogRequests', function () {
    const getLogsResponse = [
      {
        blockNumber: 1,
        blockHash: 'hash',
        transactionIndex: 1,
        removed: false,
        address: 'aaa',
        data: 'bbb',
        topics: ['topicA', 'topicB'],
        transactionHash: 'txHash',
        logIndex: '0',
      },
    ];

    it('should return the logs if it involves one request only', async function () {
      const stubProvider = {
        getLogs: () => getLogsResponse,
      } as unknown as providers.Provider;
      const logs = await performLogRequests(
        [
          {
            fromBlock: 1,
            toBlock: 10,
            address: '0x123abc',
            topics: [['eventA'], ['managerAddress']],
          },
        ],
        stubProvider
      );
      expect(logs).to.be.eql(getLogsResponse);
    });

    it('should return the logs if it involves multiple requests', async function () {
      const stubProvider = {
        getLogs: () => getLogsResponse,
      } as unknown as providers.Provider;
      const logs = await performLogRequests(
        [
          {
            fromBlock: 1,
            toBlock: 11,
            address: '0x123abc',
            topics: [['eventA'], ['managerAddress']],
          },
          {
            fromBlock: 11,
            toBlock: 21,
            address: '0x123abc',
            topics: [['eventA'], ['managerAddress']],
          },
          {
            fromBlock: 21,
            toBlock: 31,
            address: '0x123abc',
            topics: [['eventA'], ['managerAddress']],
          },
        ],
        stubProvider
      );
      const expectedLogs = [
        ...getLogsResponse,
        ...getLogsResponse,
        ...getLogsResponse,
      ];
      expect(logs).to.be.eql(expectedLogs);
    });

    it('should return the logs of the successful requests even if one request fails multiple times', async function () {
      const stubProvider = {
        getLogs: async (logFilter: providers.Filter) =>
          // the second request will fail all the times
          logFilter.fromBlock === 21
            ? Promise.reject('Just fail')
            : Promise.resolve(getLogsResponse),
      } as unknown as providers.Provider;
      const logs = await performLogRequests(
        [
          {
            fromBlock: 1,
            toBlock: 11,
            address: '0x123abc',
            topics: [['eventA'], ['managerAddress']],
          },
          {
            fromBlock: 11,
            toBlock: 21,
            address: '0x123abc',
            topics: [['eventA'], ['managerAddress']],
          },
          {
            fromBlock: 21,
            toBlock: 31,
            address: '0x123abc',
            topics: [['eventA'], ['managerAddress']],
          },
        ],
        stubProvider,
        {
          minTimeout: 0,
          maxTimeout: 200,
        }
      );
      const expectedLogs = [...getLogsResponse, ...getLogsResponse];
      expect(logs).to.be.eql(expectedLogs);
    });

    it('should return all the logs even if one request fails just once', async function () {
      let counter = 0;
      const stubProvider = {
        getLogs: async (logFilter: providers.Filter) =>
          // the second request will fail 2 times
          logFilter.fromBlock === 21 && counter++ < 2
            ? Promise.reject('Just fail')
            : Promise.resolve(getLogsResponse),
      } as unknown as providers.Provider;
      const logs = await performLogRequests(
        [
          {
            fromBlock: 1,
            toBlock: 11,
            address: '0x123abc',
            topics: [['eventA'], ['managerAddress']],
          },
          {
            fromBlock: 11,
            toBlock: 21,
            address: '0x123abc',
            topics: [['eventA'], ['managerAddress']],
          },
          {
            fromBlock: 21,
            toBlock: 31,
            address: '0x123abc',
            topics: [['eventA'], ['managerAddress']],
          },
        ],
        stubProvider,
        {
          minTimeout: 0,
          maxTimeout: 200,
        }
      );
      const expectedLogs = [
        ...getLogsResponse,
        ...getLogsResponse,
        ...getLogsResponse,
      ];
      expect(logs).to.be.eql(expectedLogs);
    });
  });
});
