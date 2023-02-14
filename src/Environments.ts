import type { BigNumberish } from 'ethers';

/**
 * We will need some mechanism to support different constants and algorithms for different networks.
 * So far the only conflict we will have is migration to Istanbul, as ETC does not integrate it as of this writing.
 * TODO: see the differences between networks we want to support and make project structure multi-chain
 */
export type RelayHubConfiguration = {
  maxWorkerCount: BigNumberish;
  minimumEntryDepositValue: BigNumberish;
  minimumUnstakeDelay: BigNumberish;
  minimumStake: BigNumberish;
};

export type Environment = {
  readonly chainId: number;
  readonly minTxGasCost: number;
  readonly relayHubConfiguration: RelayHubConfiguration;
};

const defaultRelayHubConfiguration: RelayHubConfiguration = {
  maxWorkerCount: 10,
  minimumStake: (1e18).toString(),
  minimumUnstakeDelay: 1000,
  minimumEntryDepositValue: (1e18).toString(),
};

const environments: { [key: string]: Environment } = {
  istanbul: {
    chainId: 1,
    relayHubConfiguration: defaultRelayHubConfiguration,
    minTxGasCost: 21000,
  },
  constantinople: {
    chainId: 1,
    relayHubConfiguration: defaultRelayHubConfiguration,
    minTxGasCost: 21000,
  },
  rsk: {
    chainId: 33,
    relayHubConfiguration: defaultRelayHubConfiguration,
    minTxGasCost: 21000,
  },
};

export const defaultEnvironment = environments['rsk'];
