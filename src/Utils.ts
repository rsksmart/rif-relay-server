import {
  IRelayHub,
  RelayHub,
  RelayHub__factory,
  TypedEvent,
} from '@rsksmart/rif-relay-contracts';
import chalk from 'chalk';
import config from 'config';
import { getDefaultProvider, providers, utils } from 'ethers';
import { getAddress } from 'ethers/lib/utils';
import ow from 'ow';
import { getServerConfig } from './ServerConfigParams';
import type { RelayManagerData } from '@rsksmart/rif-relay-client';

const CONFIG_CONTRACTS = 'contracts';
const CONFIG_BLOCKCHAIN = 'blockchain';
const CONFIG_RELAY_HUB_ADDRESS = 'relayHubAddress';
const CONFIG_RSK_URL = 'rskNodeUrl';
const CONFIG_RSK_WRITE_URL = 'rskNodeWriteUrl';

const getConfiguredRelayHubAddress = () =>
  config.get<string>(`${CONFIG_CONTRACTS}.${CONFIG_RELAY_HUB_ADDRESS}`);

export const getRelayHub = (
  relayHubAddress = getConfiguredRelayHubAddress(),
  provider = getProvider()
): RelayHub => RelayHub__factory.connect(relayHubAddress, provider);

// To encode and decode RelayHub calls without a contract instance
export const relayHubInterface = RelayHub__factory.createInterface();

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

export function isRegistrationValid(
  relayData: RelayManagerData | undefined,
  managerAddress: string
): boolean {
  if (relayData) {
    const {
      app: { url: serverUrl },
    } = getServerConfig();

    return (
      isSameAddress(relayData.manager, managerAddress) &&
      relayData.url === serverUrl
    );
  }

  return false;
}

export async function isContractDeployed(
  address: string,
  blockTag?: providers.BlockTag
): Promise<boolean> {
  const provider = getProvider();

  const code = await provider.getCode(address, blockTag);

  // Check added for RSKJ: when the contract does not exist in RSKJ it replies to the getCode call with 0x00
  return code !== '0x' && code !== '0x00';
}

/**
 * A StaticJsonRpcProvider whose errors don't carry its URL. ethers puts the
 * request URL in the message and the properties of every failed call, and a
 * hosted node's URL carries its API key.
 */
export class RedactingJsonRpcProvider extends providers.StaticJsonRpcProvider {
  override async send(
    method: string,
    params: Array<unknown>
  ): Promise<unknown> {
    try {
      return (await super.send(method, params)) as unknown;
    } catch (e) {
      throw redactUrlIn(e, this.connection.url);
    }
  }
}

const providersByUrl = new Map<string, providers.Provider>();

function getProviderForUrl(url: string): providers.Provider {
  let provider = providersByUrl.get(url);
  if (!provider) {
    // The chain id never changes for a running server, so we avoid the extra eth_chainId call per request
    provider = /^https?:/i.test(url)
      ? new RedactingJsonRpcProvider(url)
      : getDefaultProvider(url);
    providersByUrl.set(url, provider);
  }

  return provider;
}

/**
 * Provider used for reading the chain state.
 */
export function getProvider(): providers.Provider {
  return getProviderForUrl(
    config.get<string>(`${CONFIG_BLOCKCHAIN}.${CONFIG_RSK_URL}`)
  );
}

/**
 * Provider used for broadcasting signed transactions and reading the pending nonce of the server accounts.
 * It falls back to the read provider when `blockchain.rskNodeWriteUrl` is not set.
 */
export function getWriteProvider(): providers.Provider {
  const writeUrlKey = `${CONFIG_BLOCKCHAIN}.${CONFIG_RSK_WRITE_URL}`;
  const writeUrl = config.has(writeUrlKey)
    ? config.get<string | undefined>(writeUrlKey)
    : undefined;

  return writeUrl ? getProviderForUrl(writeUrl) : getProvider();
}

/**
 * Hides what could be a credential in a node URL (user info, path and query),
 * e.g. the API key of a hosted RPC endpoint, so the URL can be logged.
 */
export function redactUrl(url: string): string {
  try {
    const { protocol, host, pathname, search } = new URL(url);

    return `${protocol}//${host}${pathname !== '/' || search ? '/***' : ''}`;
  } catch {
    return '***';
  }
}

/**
 * Replaces a URL wherever it appears in a value with its redacted form: in a
 * string, in an error (its message, stack and own properties, since ethers
 * errors carry the URL as a property too), in an array or in a plain object.
 * Other values are returned as they are. The original value is never modified.
 */
export function redactUrlIn(value: unknown, url: string, depth = 0): unknown {
  if (!url) {
    return value;
  }
  if (typeof value === 'string') {
    return value.split(url).join(redactUrl(url));
  }
  if (depth > 3 || value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Error) {
    const redacted = Object.create(
      Object.getPrototypeOf(value) as object
    ) as Record<string, unknown>;
    const hidden = { enumerable: false, writable: true, configurable: true };
    Object.defineProperty(redacted, 'message', {
      ...hidden,
      value: redactUrlIn(value.message, url),
    });
    if (value.stack) {
      Object.defineProperty(redacted, 'stack', {
        ...hidden,
        value: redactUrlIn(value.stack, url),
      });
    }
    for (const key of Object.keys(value)) {
      redacted[key] = redactUrlIn(
        (value as unknown as Record<string, unknown>)[key],
        url,
        depth + 1
      );
    }

    return redacted;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactUrlIn(item, url, depth + 1));
  }
  if (Object.getPrototypeOf(value) === Object.prototype) {
    const source = value as Record<string, unknown>;

    return Object.keys(source).reduce<Record<string, unknown>>(
      (redacted, key) => {
        redacted[key] = redactUrlIn(source[key], url, depth + 1);

        return redacted;
      },
      {}
    );
  }

  return value;
}

const ETHERS_ERROR_CODES = new Set<string>(Object.values(utils.Logger.errors));

function isEthersError(
  e: unknown
): e is { code: string; reason?: unknown; error?: unknown } {
  const { code } = (e ?? {}) as { code?: unknown };

  return typeof code === 'string' && ETHERS_ERROR_CODES.has(code);
}

/**
 * The message a client gets for a failed request. An ethers error is reduced
 * to its reason, the node's own error when it nests one, and its code, e.g.
 * "processing response error: VM Exception while processing transaction:
 * revert Not enough tokens (SERVER_ERROR)": its message serialises the whole
 * request and response, which is for the log. Any other error is reported
 * by its message.
 */
export function clientErrorMessage(e: unknown): string {
  if (isEthersError(e)) {
    const { code, reason, error } = e;
    // the node's JSON-RPC error is nested as `error`; an ethers error nested
    // there (e.g. the server error behind UNPREDICTABLE_GAS_LIMIT) is already
    // summarised by the reason
    const nodeMessage = isEthersError(error)
      ? undefined
      : (error as { message?: unknown } | undefined)?.message;
    const details = [reason, nodeMessage].filter(
      (detail): detail is string => typeof detail === 'string'
    );

    return details.length ? `${details.join(': ')} (${code})` : code;
  }
  const { message } = (e ?? {}) as { message?: unknown };

  return typeof message === 'string' ? message : String(e);
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
    isCustom: ow.optional.boolean,
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
    isCustom: ow.optional.boolean,
  },
};
