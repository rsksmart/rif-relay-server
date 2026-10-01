# Satora testnet relay server

How to use the RIF Relay server at **https://satora.testnet.relay.rifcomputing.net** to relay
transactions from smart wallets on Rootstock testnet, with the client or the REST API.

This guide only covers what is specific to this server. For the rest, use the existing docs:

- **API reference (Swagger):** <https://satora.testnet.relay.rifcomputing.net/docs>, with every endpoint and request schema.
- **RIF Relay concepts and client setup:** <https://dev.rootstock.io/developers/integrate/rif-relay/>
  ([integrate](https://dev.rootstock.io/developers/integrate/rif-relay/integrate/),
  [smart wallets](https://dev.rootstock.io/developers/integrate/rif-relay/smart-wallets/),
  [architecture](https://dev.rootstock.io/developers/integrate/rif-relay/architecture/),
  [gas costs](https://dev.rootstock.io/developers/integrate/rif-relay/gas-costs/)).

Server config: [`config/swaps-testnet.json5`](../config/swaps-testnet.json5). Last checked on 2026-10-01 against server version `2.4.0-beta.0`.

## The server at a glance

| | |
|---|---|
| URL | `https://satora.testnet.relay.rifcomputing.net` |
| Network | Rootstock testnet, chain id `31` |
| RelayHub | `0xD2EFC2B1e5296235779A79B69e7511764E2FC8cd` |
| Payment | **Native tRBTC** on every verifier. **ERC20 tokens** only on the two full-wallet verifiers, once a token is allowed on them (none is yet). See [Paying with tokens](#paying-with-tokens). |
| Sponsored (free) transactions | Off. The relayer is paid by the smart wallet, from the funds the call brings in or from the wallet's balance. |

The server's live state is the source of truth, so check it before integrating:

```sh
URL=https://satora.testnet.relay.rifcomputing.net
curl $URL/chain-info    # hub, worker (fee receiver), minGasPrice, ready, version
curl $URL/verifiers     # verifiers the server trusts
curl "$URL/contracts?verifier=<verifier>"   # destination contracts a verifier accepts
```

`/chain-info` must report `"ready": true`.

## Contracts

Deployed on 2026-09-29 from
[rif-relay-contracts#176](https://github.com/rsksmart/rif-relay-contracts/pull/176).

| What | Address |
|---|---|
| Full wallet: factory | `0xc1341eFCCb521571Ce65a898D3a55F4DC9bD50cC` |
| Full wallet: deploy verifier | `0xf9B7CAE09A339c3Bd351AF1Cc8026360a3145130` |
| Full wallet: relay verifier | `0x22781Cb5bC8C07411C90913d3aC64783276615bD` |
| Minimal wallet: factory | `0x4198c5914228bD2eDA528f006EE08165c0af65E6` |
| Minimal wallet: deploy verifier | `0x3049bdB0F76Ca70910EDcA5bEa809E1aE2603572` |
| Minimal wallet: relay verifier (always rejects) | `0x78BfA240b9695c8fc41f633E6678d06cC7F4A985` |
| Allowed destinations: `HTLCNative` / `HTLCNativeCoordinator` | `0x18123A31261a76c74C82ED2F8346002CaA78Ab39` / `0x447a4CD711CE66D25c7008d26D5f09cA7D621F48` |

## Which wallet to use

| Wallet | Deploy + call in one request | Relay from an existing wallet | Fee paid in | Methods allowed |
|---|---|---|---|---|
| Full | yes | yes | native, or an allowed ERC20 | `HTLCNative.redeem`, `redeemBySig`, `HTLCNativeCoordinator.redeemAndExecute` |
| Minimal | yes | **no** (deploy only) | native only | the same three |

The minimal wallet is cheaper to deploy.
Use the full wallet if later calls should be relayed from the same wallet.

## How the fee is paid

The user does not need RBTC. The smart wallet pays the relayer `tokenAmount` (native) when the request executes, either out of
the RBTC the call sends into the wallet (for example a redeem) or out of the wallet's balance. You can also pay with a token
(see [Paying with tokens](#paying-with-tokens)).

- The verifier checks that the fee does not exceed what is available to the wallet, counting the funds the call will bring in.
  Estimating or relaying a call whose preconditions do not hold yet is rejected.
- **Fee = `requiredNativeAmount` from `/estimate`, plus headroom for gas price changes.**

## Paying with tokens

The two full-wallet verifiers (deploy and relay) also accept an ERC20 as the fee. The minimal-wallet verifiers do not:
they require native payment (`tokenContract = 0x0`).

- The token must be allowed on the verifier. `GET /tokens?verifier=<verifier>` lists the allowed tokens. **It is empty for every
  verifier today**, so only native payment works until the verifier owner runs `allow-tokens`
  ([rif-relay-contracts](https://github.com/rsksmart/rif-relay-contracts) deploy tasks) for a token.
- The smart wallet must already hold the fee in that token when the request is relayed. The verifier checks the wallet's
  `balanceOf`, so a fee paid out of the funds the call brings in does not apply.
- Set `tokenContract` to the token and `tokenAmount` to the fee in token units. `POST /estimate` returns `requiredTokenAmount`
  (converted with an exchange rate) and the `exchangeRate` it used.

## Using the client

Install a client that includes the deploy gas-estimation fix
([rif-relay-client#101](https://github.com/rsksmart/rif-relay-client/pull/101), branch `fix/deploy-gas-estimation`).
Until it is released, install it from GitHub (building it from git needs Node 18 or newer):

```sh
cd your-project
npm install github:rsksmart/rif-relay-client#fix/deploy-gas-estimation
```

Setup is the same as in the [Rootstock integration guide](https://dev.rootstock.io/developers/integrate/rif-relay/integrate/)
(including the Account Manager, if you sign with a browser wallet). Only the values change:

```ts
import { BigNumber, constants, providers } from 'ethers';
import {
  AccountManager, RelayClient, setEnvelopingConfig, setProvider,
} from '@rsksmart/rif-relay-client';

setProvider(new providers.JsonRpcProvider('https://public-node.testnet.rsk.co'));
setEnvelopingConfig({
  chainId: 31,
  preferredRelays: ['https://satora.testnet.relay.rifcomputing.net'],
  relayHubAddress: '0xD2EFC2B1e5296235779A79B69e7511764E2FC8cd',
  deployVerifierAddress: '0xf9B7CAE09A339c3Bd351AF1Cc8026360a3145130',
  relayVerifierAddress: '0x22781Cb5bC8C07411C90913d3aC64783276615bD',
});
AccountManager.getInstance().addAccount(owner); // the EOA that owns the smart wallet
const client = new RelayClient();
```

Deploy the user's wallet and make a call in one request (full wallet):

```ts
const FACTORY = '0xc1341eFCCb521571Ce65a898D3a55F4DC9bD50cC';
const DEPLOY_VERIFIER = '0xf9B7CAE09A339c3Bd351AF1Cc8026360a3145130';
const index = 1; // any unused index; it, with the owner, determines the wallet address
// `factory` is the wallet factory contract; `target` is an allowed destination contract and `callData` the call to it.

// The wallet address exists before it is deployed, so it can be used as the recipient in the call.
const wallet = await factory.getSmartWalletAddress(owner.address, constants.AddressZero, index);

const deployRequest = (tokenAmount: BigNumber | number) => ({
  request: {
    from: owner.address,
    to: TARGET, // an allowed destination contract
    data: callData,
    tokenContract: constants.AddressZero,
    tokenAmount, // the fee, in tRBTC wei
    index,
  },
  relayData: { callForwarder: FACTORY, callVerifier: DEPLOY_VERIFIER },
});

const { requiredNativeAmount } = await client.estimateRelayTransaction(deployRequest(0));
const fee = BigNumber.from(requiredNativeAmount).mul(105).div(100);
const { hash } = await client.relayTransaction(deployRequest(fee));
```

For the minimal wallet, swap in its factory and deploy verifier. To relay from an **already deployed** full wallet, send the
same request without `index`, with `relayData: { callForwarder: <wallet>, callVerifier: <relay verifier> }`.

A complete, runnable example for both wallets is the e2e suite in
[rif-relay#300](https://github.com/rsksmart/rif-relay/pull/300) (`test/lendaswap/Lendaswap.test.ts`).

**Client behavior to know:** the client sends the relay request to the URL **registered on the hub** for the server's manager,
not to `preferredRelays`. That URL is now the satora domain. See [Troubleshooting](#troubleshooting).

## Using the REST API directly

The [Swagger page](https://satora.testnet.relay.rifcomputing.net/docs) lists every endpoint with its schemas and examples.

| Method | Path | Use |
|---|---|---|
| GET | `/chain-info` | Hub, worker and fee receiver, `minGasPrice`, `ready`, version. Read this before building a request. |
| GET | `/status` | `204` if the server is up |
| GET | `/verifiers` | Trusted verifiers |
| GET | `/contracts?verifier=` | Destination contracts the verifier accepts |
| GET | `/tokens?verifier=` | ERC20 tokens the verifier accepts (empty today, so native only) |
| POST | `/estimate` | Gas and required native amount for a request (`requiredNativeAmount`, `estimation`, `gasPrice`) |
| POST | `/relay` | Sends the request. Returns `{ signedTx, transactionHash }`. |

`POST /estimate` and `POST /relay` take a signed request (`DeployTransactionRequest` or `RelayTransactionRequest` in the
Swagger schemas). The pieces to get right:

1. From `/chain-info`: `relayData.feesReceiver` = `feesReceiver`, the hub address, and `relayData.gasPrice` at least `minGasPrice`.
2. `callForwarder` and `callVerifier` come from the table above.
3. `metadata.signature` is the owner's EIP-712 signature over the request. It is easy to get wrong by hand, so use the
   client unless you cannot.
4. Estimate first with `tokenAmount = 0` (as the client does), then set `tokenAmount` to `requiredNativeAmount` plus headroom
   and sign the final request.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `ready: false` in `/chain-info`, or the client reports `Hub is not ready` | The server is starting or re-registering. Retry in a minute. |
| The client fails with a DNS error for a host that is not `satora…` | The URL registered on the hub differs from the server's domain. Check `RelayHub.getRelayInfo(<manager>).url`; it must be the satora URL. |
| `cannot estimate gas` when deploying | An old client without [rif-relay-client#101](https://github.com/rsksmart/rif-relay-client/pull/101). |
| The relay request is rejected by the verifier | A precondition of the call does not hold yet, the fee is above what is available to the wallet, or the method or destination is not in the allowed list. |
