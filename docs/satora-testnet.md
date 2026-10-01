# Satora testnet relay server

How to use the RIF Relay server at **https://satora.testnet.relay.rifcomputing.net** to sponsor
[Lendaswap](https://github.com/satoraHQ/lendaswap-contracts) swap claims and
Flyover peg-in registrations on Rootstock testnet.

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
| RelayHub | `0xD2EFC2B1e5296235779A79B69e7511764E2FC8cd` (shared with the Boltz testnet server) |
| Payment | **Native tRBTC only** (`tokenContract` is always `0x000…000`) |
| Sponsored (free) transactions | Off. The relayer is paid from the claimed funds (Lendaswap) or from the collateral reward (Flyover). |

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
[rif-relay-contracts `feat/flyover-lendaswap`](https://github.com/rsksmart/rif-relay-contracts/tree/feat/flyover-lendaswap)
(PRs [#176](https://github.com/rsksmart/rif-relay-contracts/pull/176) and
[#175](https://github.com/rsksmart/rif-relay-contracts/pull/175)).

| What | Address |
|---|---|
| Lendaswap full: factory | `0xc1341eFCCb521571Ce65a898D3a55F4DC9bD50cC` |
| Lendaswap full: deploy verifier | `0xf9B7CAE09A339c3Bd351AF1Cc8026360a3145130` |
| Lendaswap full: relay verifier | `0x22781Cb5bC8C07411C90913d3aC64783276615bD` |
| Lendaswap minimal: factory | `0x4198c5914228bD2eDA528f006EE08165c0af65E6` |
| Lendaswap minimal: deploy verifier | `0x3049bdB0F76Ca70910EDcA5bEa809E1aE2603572` |
| Lendaswap minimal: relay verifier (always rejects) | `0x78BfA240b9695c8fc41f633E6678d06cC7F4A985` |
| Flyover: factory | `0x20C92c40d3639838886CB432492950e256efD2CB` |
| Flyover: deploy verifier | `0xC21444eAB71A08A90f7726f0Bcbb6d317AE5c7c2` |
| Lendaswap `HTLCNative` / `HTLCNativeCoordinator` (testnet) | `0x18123A31261a76c74C82ED2F8346002CaA78Ab39` / `0x447a4CD711CE66D25c7008d26D5f09cA7D621F48` |
| Flyover PegIn / CollateralManagement (testnet) | `0xB29fa9754D41C3Bb17d5f89290294F48C13Af59b` / `0xF4CeD744227E0c50F822e40eF64917093bcf09b3` |

## What has been verified on testnet

| Flow | Status |
|---|---|
| Lendaswap full wallet: deploy + `redeem`, deploy + `redeemAndExecute` | passed |
| Lendaswap minimal wallet: deploy + `redeemBySig`, deploy + `redeem` | passed (the `redeem` run on `2.4.0-beta.0`, with the client finding the server through the hub; the others on the previous build) |
| Relay from an already deployed wallet | not run on testnet yet (covered by the local e2e suite) |
| Flyover `registerPegIn` | not run on testnet yet (covered by the contract tests) |

## Which wallet to use

| Wallet | Deploy + call in one request | Relay from an existing wallet | Methods allowed |
|---|---|---|---|
| Lendaswap full | yes | yes | `HTLCNative.redeem`, `redeemBySig`, `HTLCNativeCoordinator.redeemAndExecute` |
| Lendaswap minimal | yes | **no** (deploy only) | the same three |
| Flyover | yes | **no** (deploy only) | `PegIn.registerPegIn` only |

The minimal wallet is cheaper to deploy: the server's estimates were about 229k to 238k gas, against 250k to 271k for the full wallet.
Use the full wallet if later claims should be relayed from the same wallet.

## Lendaswap: how a claim is paid

The user has no RBTC. The swap's RBTC is claimed **into the smart wallet** during the deploy or relay, and the
wallet pays the relayer `tokenAmount` (native) out of it. The rest stays with the owner.

| Claim call | Who may claim | Counted toward the fee |
|---|---|---|
| `HTLCNative.redeem` | the smart wallet is the swap's `claimAddress` | the swap amount |
| `HTLCNative.redeemBySig` | EIP-712 signature from the `claimAddress`, naming the wallet as `caller` | the swap amount |
| `HTLCNativeCoordinator.redeemAndExecute` | EIP-712 signature naming the coordinator as `caller` | the swap amount if there are no calls, else `minAmountOut`; `0` unless the RBTC is swept to the wallet |

- **Lock the swap first.** The verifier checks the swap is active, so estimating or relaying before it exists is rejected.
- **Fee = `requiredNativeAmount` from `/estimate`, plus headroom for gas price changes.** Our runs used 1.05x to 3x.
  It must stay below the amount counted toward the fee.
- Fees are small on testnet (`requiredNativeAmount` was about 0.000014 to 0.000016 tRBTC in our runs), so a swap must be
  worth more than that.

## Using the client

Install a client that includes the deploy gas-estimation fix
([rif-relay-client#101](https://github.com/rsksmart/rif-relay-client/pull/101), branch `fix/deploy-gas-estimation`).
It was tested at commit `83809ef`. Until it is released, install it from GitHub (building it from git needs Node 18 or newer):

```sh
cd your-project
npm install github:rsksmart/rif-relay-client#fix/deploy-gas-estimation
```

We have not tested the published `2.2.6` against this server.

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

Deploy the user's wallet and claim in one request (full wallet, `redeem`):

```ts
const FACTORY = '0xc1341eFCCb521571Ce65a898D3a55F4DC9bD50cC';
const DEPLOY_VERIFIER = '0xf9B7CAE09A339c3Bd351AF1Cc8026360a3145130';
const index = 1; // any unused index; it, with the owner, determines the wallet address
// `factory` and `htlc` are ethers contracts. HTLCNative's ABI is in rif-relay#300 (test/lendaswap/fixtures).

// The wallet address exists before it is deployed. For `redeem`, lock the swap with claimAddress = this address.
const wallet = await factory.getSmartWalletAddress(owner.address, constants.AddressZero, index);

const deployRequest = (tokenAmount: BigNumber | number) => ({
  request: {
    from: owner.address,
    to: HTLC_NATIVE, // or HTLCNativeCoordinator for redeemAndExecute
    data: htlc.interface.encodeFunctionData('redeem', [preimage, amount, sender, timelock]),
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

For `redeemBySig` and `redeemAndExecute`, the owner also signs the EIP-712 `Redeem` message of `HTLCNative`. A complete,
runnable example of all three claims, for both wallets, is the e2e suite in
[rif-relay#300](https://github.com/rsksmart/rif-relay/pull/300) (`test/lendaswap/Lendaswap.test.ts`).

**Client behavior to know:** the client sends the relay request to the URL **registered on the hub** for the server's manager,
not to `preferredRelays`. That URL is now the satora domain. See [Troubleshooting](#troubleshooting).

## Flyover

Flyover is deploy-only. The deploy registers a peg-in whose liquidity provider did not deliver. The relayer is paid from the
collateral punisher reward, and the user's refund goes to the quote's `rskRefundAddress`.

The request must have:

- `tokenContract = 0x0`, `tokenAmount = 0`, `tokenGas = 0` and `value = 0`. There is no token fee.
- `to` = the PegIn contract above, and `data` = the `registerPegIn(quote, signature, btcRawTransaction, partialMerkleTree, height)` call.
- a quote with `lbcAddress` = the PegIn contract, `chainId = 31` and `penaltyFee > 0`, which PegIn still reports as
  unprocessed (the LP never ran `callForUser`).
- a punisher reward (`penaltyFee` x `rewardPercentage` / 10000) of at least the verifier's `minPunisherReward`, currently `0`.

Build the request like the Lendaswap one, with the Flyover factory and deploy verifier (not run on testnet yet). Contract details are in
[rif-relay-contracts#175](https://github.com/rsksmart/rif-relay-contracts/pull/175).

## Using the REST API directly

The [Swagger page](https://satora.testnet.relay.rifcomputing.net/docs) lists every endpoint with its schemas and examples.

| Method | Path | Use |
|---|---|---|
| GET | `/chain-info` | Hub, worker and fee receiver, `minGasPrice`, `ready`, version. Read this before building a request. |
| GET | `/status` | `204` if the server is up |
| GET | `/verifiers` | Trusted verifiers |
| GET | `/contracts?verifier=` | Destination contracts the verifier accepts |
| GET | `/tokens?verifier=` | ERC20 tokens the verifier accepts (none here; native only) |
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
| `cannot estimate gas` when deploying | An old client without [rif-relay-client#101](https://github.com/rsksmart/rif-relay-client/pull/101). We saw it in our integration tests on RSKj Vetiver with the client before that fix. |
| The relay request is rejected by the verifier | The swap is not locked or not active yet, the fee is above the amount counted toward it, or the method or destination is not in the allowed list. |
