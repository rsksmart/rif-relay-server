import {CommandClient} from "./helpers/CommandClient";
import {constants, EnvelopingConfig, isSameAddress} from "@rsksmart/rif-relay-common";
import BN from "bn.js";
import {fromWei, toBN} from "web3-utils";
import {TransactionReceipt} from "web3-core";
import {getParams} from "./helpers/Utils";
import {parseServerConfig} from "../ServerConfigParams";
import {configure} from "@rsksmart/rif-relay-client";
// @ts-ignore
import {ether} from "@openzeppelin/test-helpers";

interface RegisterOptions {
  from: string
  gasPrice: string | BN
  stake: string | BN
  funds: string | BN
  relayUrl: string
  unstakeDelay: string
}

interface RegistrationResult {
  success: boolean
  transactions?: string[]
  error?: string
}

export class Register extends CommandClient {
  constructor(host: string, config: EnvelopingConfig, mnemonic?: string) {
    super(host, config, mnemonic);
  }

  async execute(options: RegisterOptions): Promise<void> {
    const transactions: string[] = []
      console.log(`Registering Enveloping relayer at ${options.relayUrl}`);
      const response = await this.httpClient.getPingResponse(options.relayUrl);
      if (response.ready) {
        throw new Error('Already registered');
      }

      if (!this.contractInteractor.isInitialized()) {
        await this.contractInteractor.init()
      }

      const chainId = this.contractInteractor.chainId;

      if (response.chainId !== chainId.toString()) {
        throw new Error(`wrong chain-id: Relayer on (${response.chainId}) but our provider is on (${chainId})`);
      }

      const relayAddress = response.relayManagerAddress
      const relayHubAddress = this.config.relayHubAddress ?? response.relayHubAddress
      const relayHub = await this.contractInteractor._createRelayHub(relayHubAddress)
      const { stake, unstakeDelay, owner } = await relayHub.getStakeInfo(relayAddress)

      console.log('Current stake info:')
      console.log('Relayer owner: ', owner)
      console.log('Current unstake delay: ', unstakeDelay)
      console.log('current stake=', fromWei(stake, 'ether'))

      if (owner !== constants.ZERO_ADDRESS && !isSameAddress(owner, options.from)) {
        throw new Error(`Already owned by ${owner}, our account=${options.from}`)
      }

      if (toBN(unstakeDelay).gte(toBN(options.unstakeDelay)) && toBN(stake).gte(toBN(options.stake.toString()))) {
        console.log('Relayer already staked');
      } else {
        const stakeValue = toBN(options.stake.toString()).sub(toBN(stake))
        console.log(`Staking relayer ${fromWei(stakeValue, 'ether')} RBTC`,
            stake === '0' ? '' : ` (already has ${fromWei(stake, 'ether')} RBTC)`)

        const stakeTx = await relayHub
            .stakeForAddress(relayAddress, options.unstakeDelay.toString(), {
              value: stakeValue,
              from: options.from,
              gas: 1e6,
              gasPrice: options.gasPrice
            })
        transactions.push(stakeTx.tx)
      }

      if (isSameAddress(owner, options.from)) {
        console.log('Relayer already authorized');
      }

      const bal = await this.contractInteractor.getBalance(relayAddress);

      if (toBN(bal).gt(toBN(options.funds.toString()))) {
        console.log('Relayer already funded');
      } else {
        console.log('Funding relayer')

        const _fundTx = await this.web3.eth.sendTransaction({
          from: options.from,
          to: relayAddress,
          value: options.funds,
          gas: 1e6,
          gasPrice: options.gasPrice
        })
        const fundTx = _fundTx as TransactionReceipt
        if (fundTx.transactionHash == null) {
          throw new Error(`Fund transaction reverted: ${JSON.stringify(_fundTx)}`);
        }
        transactions.push(fundTx.transactionHash)
      }

      await this.waitForRelay(options.relayUrl)
      console.log('Executed Transactions', transactions)
  }
}

const parameters = getParams();

console.log('Argv', process.argv.slice(2));
console.log('Parameters', parameters);

// const serverConfiguration = await parseServerConfig(process.argv.slice(2), process.env);
// const register = new Register(serverConfiguration.rskNodeUrl, configure({ relayHubAddress: serverConfiguration.relayHubAddress }), parameters.mnemonic);
// const registerOptions: RegisterOptions = {
//   hub: serverConfiguration.relayHubAddress,
//   from: parameters.from ?? await register.findWealthyAccount(),
//   stake: ether(parameters.stake ?? '0.01'),
//   funds: ether(parameters.funds ?? '0.02'),
//   relayUrl: parameters.relayUrl ?? 'http://localhost:8090',
//   unstakeDelay: parameters.unstakeDelay ?? 1000,
//   gasPrice: parameters.gasPrice ?? 60000000
// };
// register.execute(registerOptions)
// .then(() => {
//   console.log('Registration is done!');
// }).catch(error => {
//   console.log('Error registering relay server', error);
// });
