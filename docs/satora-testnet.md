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

Server config: [`config/swaps-testnet.json5`](../config/swaps-testnet.json5).

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

`/chain-info` must report `"ready": true`, and `/verifiers` must list the four verifiers below.

## Contracts

From [rif-relay-contracts `v2.2.1-beta.0`](https://github.com/rsksmart/rif-relay-contracts/tree/v2.2.1-beta.0)
([#181](https://github.com/rsksmart/rif-relay-contracts/pull/181)). The verifiers and the minimal wallet were deployed on
2026-10-23. The full wallet's template and factory are the ones deployed on 2026-10-15, so full wallets created
before keep their address.

| What | Address |
|---|---|
| Full wallet: factory | `0x85D9C99b8d2fB2f1cc5d54d4e15E3F39e66852B3` |
| Full wallet: deploy verifier | `0x3D52678C7329C75590D35b8415F83c6EDF35BCF8` |
| Full wallet: relay verifier | `0x485C241B07868CE8174e52EFFFe135bCD4E2ADE3` |
| Minimal wallet: factory | `0x20439219901784A03D45e3a357ecbF05D8486cEE` |
| Minimal wallet: deploy verifier | `0x95cA494363c2EafFbB321bEF2B872978C583ea05` |
| Minimal wallet: relay verifier (always rejects) | `0xF62729882501fbDF06b98fC63455b0366724B30A` |
| Allowed destination: `HTLCNative` | `0x18123A31261a76c74C82ED2F8346002CaA78Ab39` |

The `HTLCNativeCoordinator` is **not** an allowed destination. The verifiers deployed before 2026-10-23 are no longer
trusted by the server, and requests that name them are rejected.

## Which wallet to use

| Wallet | Deploy + call in one request | Relay from an existing wallet | Fee paid in | Methods allowed |
|---|---|---|---|---|
| Full | yes | yes | native, or an allowed ERC20 | `HTLCNative.redeem`, `HTLCNative.redeemBySig` |
| Minimal | yes | **no** (deploy only) | native only | the same two |

The minimal wallet is cheaper to deploy.
Use the full wallet if later calls should be relayed from the same wallet.

A full wallet can also be deployed with no call (`to` = `0x0000000000000000000000000000000000000000`) only if a
verifier owner allows the zero address on its deploy verifier; it is not allowed today.

`redeemAndExecute` and every other method are rejected with `Method not allowed`. The verifiers accept only the two
redeems because they pay the smart wallet itself and run no code chosen by the request before the wallet pays the fee.

### What a `redeemBySig` must sign

HTLCNative pays the caller of `redeemBySig`, the smart wallet. The verifiers also check the fields the claimant signs:

- `destination`: the smart wallet, or the zero address;
- `sweepToken`: the zero address;
- `callsHash`: zero (as clients sign it today), or the hash of an empty call list.

A claim that signs anything else is rejected, even when it would otherwise be valid. `redeem` and `redeemBySig`
must forward no value (`value` = 0).

## How the fee is paid

The user does not need RBTC. The smart wallet pays the relayer `tokenAmount` (native) when the request executes, either out of
the RBTC the redeem sends into the wallet or out of the wallet's balance. You can also pay with a token
(see [Paying with tokens](#paying-with-tokens)).

- The verifier checks that the fee does not exceed what is available to the wallet, counting the RBTC the redeem will bring in.
  Estimating or relaying a redeem whose swap is not active yet is rejected.
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

Install [rif-relay-client `v2.3.2`](https://github.com/rsksmart/rif-relay-client/tree/v2.3.2). It is a GitHub tag, not
an npm release, so install it from GitHub (building it from git needs Node 18 or newer):

```sh
cd your-project
npm install github:rsksmart/rif-relay-client#v2.3.2
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
  deployVerifierAddress: '0x3D52678C7329C75590D35b8415F83c6EDF35BCF8',
  relayVerifierAddress: '0x485C241B07868CE8174e52EFFFe135bCD4E2ADE3',
});
AccountManager.getInstance().addAccount(owner); // the EOA that owns the smart wallet
const client = new RelayClient();
```

Deploy the user's wallet and claim in one request (full wallet):

```ts
const FACTORY = '0x85D9C99b8d2fB2f1cc5d54d4e15E3F39e66852B3';
const DEPLOY_VERIFIER = '0x3D52678C7329C75590D35b8415F83c6EDF35BCF8';
const HTLC_NATIVE = '0x18123A31261a76c74C82ED2F8346002CaA78Ab39';
const index = 1; // any unused index; it, with the owner, determines the wallet address
// `factory` is the wallet factory contract; `redeemData` is an HTLCNative redeem or redeemBySig call.

// The wallet address exists before it is deployed, so it can be the swap's claim address.
const wallet = await factory.getSmartWalletAddress(owner.address, constants.AddressZero, index);

const deployRequest = (tokenAmount: BigNumber | number) => ({
  request: {
    from: owner.address,
    to: HTLC_NATIVE,
    data: redeemData,
    tokenContract: constants.AddressZero,
    tokenAmount, // the fee, in tRBTC wei
    index,
  },
  relayData: { callForwarder: FACTORY, callVerifier: DEPLOY_VERIFIER },
});

const { requiredNativeAmount } = await client.estimateRelayTransaction(deployRequest(0));
const fee = BigNumber.from(requiredNativeAmount).mul(110).div(100);
const { hash } = await client.relayTransaction(deployRequest(fee));
```

For the minimal wallet, swap in its factory and deploy verifier. To relay from an **already deployed** full wallet, send the
same request without `index`, with `relayData: { callForwarder: <wallet>, callVerifier: <relay verifier> }`.

A complete, runnable example for both wallets is the e2e suite in
[rif-relay#300](https://github.com/rsksmart/rif-relay/pull/300) (`test/lendaswap/Lendaswap.test.ts`).

**Client behavior to know:** the client sends the relay request to the URL **registered on the hub** for the server's manager,
not to `preferredRelays`. That URL is the satora domain. See [Troubleshooting](#troubleshooting).

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
| POST | `/relay` | Sends the request. Returns `{ signedTx, txHash }`. |

`POST /estimate` and `POST /relay` take a signed request (`DeployTransactionRequest` or `RelayTransactionRequest` in the
Swagger schemas). The pieces to get right:

1. From `/chain-info`: `relayData.feesReceiver` = `feesReceiver`, the hub address, and `relayData.gasPrice` at least `minGasPrice`.
   The server also refuses a gasPrice far above the node's; the client's default (0.06 gwei) is accepted.
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
| `Method not allowed` | The call is not an HTLCNative `redeem` or `redeemBySig` (for example `redeemAndExecute`). |
| `Destination contract not allowed`, or the client reports `cannot estimate gas` | `to` is not HTLCNative, for example the coordinator. The client's own gas estimate fails first and hides the verifier's reason. |
| `Another request for the same swap is already being relayed; retry once it is mined` | A claim of the same swap is in flight. Wait for it to be mined; if it reverted, retry. |
| `Unacceptable gasPrice` | `relayData.gasPrice` is below `minGasPrice`, or far above the node's gas price. |
| `Invalid verifier: <address>` | The request names a verifier from before 2026-10-23. Use the addresses above. |
| The relay request is rejected by the verifier | The swap is not active, the fee is above what is available to the wallet, or a `redeemBySig` signs a field the verifiers refuse (see [What a `redeemBySig` must sign](#what-a-redeembysig-must-sign)). |
