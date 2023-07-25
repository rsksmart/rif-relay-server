import chalk from 'chalk';
import log from 'loglevel';
import {
  TokenHandler__factory,
  IDeployVerifier__factory,
  IRelayVerifier__factory,
  IDeployVerifier,
  IRelayVerifier,
} from '@rsksmart/rif-relay-contracts';
import type { TypedEvent } from '@rsksmart/rif-relay-contracts';
import { replenishStrategy } from './ReplenishFunction';
import { RegistrationManager } from './RegistrationManager';
import {
  SendTransactionDetails,
  SignedTransactionDetails,
  TransactionManager,
} from './TransactionManager';
import { ServerAction } from './StoredTransaction';
import type { TxStoreManager } from './TxStoreManager';
import {
  ServerDependencies,
  getServerConfig,
  ServerConfigParams,
} from './ServerConfigParams';
import Timeout = NodeJS.Timeout;
import EventEmitter from 'events';
import {
  utils,
  constants,
  Event,
  PopulatedTransaction,
  BigNumber,
  providers,
  BigNumberish,
} from 'ethers';
import ow from 'ow';
import {
  deployTransactionRequestShape,
  getLatestEventData,
  getPastEventsForHub,
  getProvider,
  getRelayHub,
  isContractDeployed,
  randomInRange,
  relayTransactionRequestShape,
  sleep,
} from './Utils';
import { AmountRequired } from './AmountRequired';
import {
  EnvelopingTxRequest,
  estimateRelayMaxPossibleGas,
  isDeployRequest,
  isDeployTransaction,
  maxPossibleGasVerification,
  RelayRequest,
  setProvider,
  standardMaxPossibleGasEstimation,
} from '@rsksmart/rif-relay-client';
import {
  validateIfGasAmountIsAcceptable,
  validateIfTokenAmountIsAcceptable,
  convertGasToTokenAndNative,
  calculateFee,
  validateExpirationTime,
} from './relayServerUtils';

const VERSION = '2.0.1';

type HubInfo = {
  relayWorkerAddress: string;
  feesReceiver: string;
  relayManagerAddress: string;
  relayHubAddress: string;
  minGasPrice: string;
  networkId?: string;
  chainId?: string;
  ready: boolean;
  version: string;
};

type TokenResponse = {
  [verifier: string]: string[];
};

export type VerifierResponse = {
  trustedVerifiers: string[];
};

export type RelayEstimation = {
  gasPrice: string;
  estimation: string;
  requiredTokenAmount: string;
  requiredNativeAmount: string;
  exchangeRate: string;
};

export type MaxPossibleGas = {
  maxPossibleGas: BigNumber;
  maxPossibleGasWithFee: BigNumber;
};

export class RelayServer extends EventEmitter {
  private _lastScannedBlock = 0;

  private _lastRefreshBlock = 0;

  private _ready = false;

  private _lastSuccessfulRounds = Number.MAX_SAFE_INTEGER;

  readonly managerAddress: string;

  readonly workerAddress: string;

  readonly feesReceiver: string;

  gasPrice = BigNumber.from(0);

  private _workerSemaphoreOn = false;

  private _alerted = false;

  alertedBlock = 0;

  private _initialized = false;

  private _workerTask?: Timeout;

  config: ServerConfigParams;

  transactionManager: TransactionManager;

  txStoreManager: TxStoreManager;

  lastMinedActiveTransaction?: Event;

  registrationManager!: RegistrationManager;

  chainId: number | undefined;

  networkId: number | undefined;

  trustedVerifiers: Set<string | undefined> = new Set<string | undefined>();

  workerBalanceRequired: AmountRequired;

  private readonly _customReplenish: boolean;

  constructor(dependencies: ServerDependencies) {
    super();
    this.config = getServerConfig();
    const {
      app: { customReplenish },
      contracts: { feesReceiver },
      blockchain: { workerMinBalance, initialBlockToScan },
    } = this.config;
    setProvider(getProvider());
    this._lastScannedBlock = initialBlockToScan;
    this.txStoreManager = dependencies.txStoreManager;
    this.transactionManager = new TransactionManager(dependencies);
    this.managerAddress =
      this.transactionManager.managerKeyManager.getAddress(0) ?? '';
    this.workerAddress =
      this.transactionManager.workersKeyManager.getAddress(0) ?? '';
    this.feesReceiver =
      feesReceiver === constants.AddressZero
        ? this.workerAddress
        : feesReceiver;
    this._customReplenish = customReplenish;
    this.workerBalanceRequired = new AmountRequired(
      'Worker Balance',
      BigNumber.from(workerMinBalance)
    );
    this.printServerAddresses();

    log.info('RelayServer version', VERSION);
    log.info('Using server configuration:\n', this.config);
  }

  printServerAddresses(): void {
    log.info(`Server manager address  | ${this.managerAddress}`);
    log.info(`Server worker  address  | ${this.workerAddress}`);
  }

  getMinGasPrice(): BigNumber {
    return this.gasPrice;
  }

  isCustomReplenish(): boolean {
    return this._customReplenish;
  }

  getChainInfo(): HubInfo {
    return {
      relayWorkerAddress: this.workerAddress,
      feesReceiver: this.feesReceiver,
      relayManagerAddress: this.managerAddress,
      relayHubAddress: this.config.contracts.relayHubAddress,
      minGasPrice: this.getMinGasPrice().toString(),
      chainId: this.chainId?.toString(),
      networkId: this.networkId?.toString(),
      ready: this.isReady() ?? false,
      version: VERSION,
    };
  }

  async tokenHandler(verifier?: string): Promise<TokenResponse> {
    let verifiersToQuery: string[];

    // if a verifier was supplied, check that it is trusted
    if (verifier !== undefined) {
      if (!this.trustedVerifiers.has(verifier.toLowerCase())) {
        throw new Error('supplied verifier is not trusted');
      }
      verifiersToQuery = [verifier];
    } else {
      // if no verifier was supplied, query all tursted verifiers
      verifiersToQuery = Array.from(this.trustedVerifiers) as string[];
    }

    const res: TokenResponse = {};
    const provider = getProvider();

    for (const verifier of verifiersToQuery) {
      const tokenHandlerInstance = TokenHandler__factory.connect(
        verifier,
        provider
      );
      const acceptedTokens = await tokenHandlerInstance.getAcceptedTokens();
      res[utils.getAddress(verifier)] = acceptedTokens;
    }

    return res;
  }

  verifierHandler(): VerifierResponse {
    return {
      trustedVerifiers: Array.from(this.trustedVerifiers) as string[],
    };
  }

  validateInputTypes(envelopingTransaction: EnvelopingTxRequest): void {
    if (isDeployTransaction(envelopingTransaction)) {
      ow(
        envelopingTransaction,
        ow.object.exactShape(deployTransactionRequestShape)
      );
    } else {
      ow(
        envelopingTransaction,
        ow.object.exactShape(relayTransactionRequestShape)
      );
    }
  }

  async validateInput(envelopingRequest: EnvelopingTxRequest): Promise<void> {
    const { metadata, relayRequest } = envelopingRequest;

    const {
      app: { requestMinValidSeconds },
      contracts: { relayHubAddress },
    } = this.config;

    // Check that the relayHub is the correct one
    if (
      metadata.relayHubAddress.toString().toLowerCase() !==
      relayHubAddress.toLowerCase()
    ) {
      throw new Error(
        `Wrong hub address.\nRelay server's hub address: ${
          this.config.contracts.relayHubAddress
        }, request's hub address: ${metadata.relayHubAddress.toString()}\n`
      );
    }

    const feesReceiver = relayRequest.relayData.feesReceiver.toString();
    // Check the relayWorker (todo: once migrated to multiple relays, check if exists)
    if (feesReceiver.toLowerCase() !== this.feesReceiver.toLowerCase()) {
      throw new Error(`Wrong fees receiver address: ${feesReceiver}\n`);
    }

    const gasPrice = relayRequest.relayData.gasPrice.toString();
    // Check that the gasPrice is initialized & acceptable
    if (this.gasPrice.gt(gasPrice)) {
      throw new Error(
        `Unacceptable gasPrice: relayServer's gasPrice:${this.gasPrice.toString()} request's gasPrice: ${gasPrice}`
      );
    }

    // validate the validUntil is not too close
    await validateExpirationTime(
      relayRequest.request.validUntilTime,
      requestMinValidSeconds
    );
  }

  validateVerifier(envelopingRequest: EnvelopingTxRequest): void {
    const callVerifier =
      envelopingRequest.relayRequest.relayData.callVerifier.toString();
    if (!this.isTrustedVerifier(callVerifier)) {
      throw new Error(`Invalid verifier: ${callVerifier}`);
    }
  }

  async validateMaxNonce(relayMaxNonce: string): Promise<void> {
    // Check that max nonce is valid
    const nonce = await this.transactionManager.pollNonce(this.workerAddress);
    if (nonce > Number(relayMaxNonce)) {
      throw new Error(
        `Unacceptable relayMaxNonce: ${relayMaxNonce}. current nonce: ${nonce}`
      );
    }
  }

  async validateRequestWithVerifier(
    envelopingTransaction: EnvelopingTxRequest
  ): Promise<void> {
    const verifier =
      envelopingTransaction.relayRequest.relayData.callVerifier.toString();

    if (!this.isTrustedVerifier(verifier)) {
      throw new Error('Invalid verifier');
    }

    let verifierContract: IRelayVerifier | IDeployVerifier;

    const provider = getProvider();

    try {
      if (isDeployTransaction(envelopingTransaction)) {
        verifierContract = IDeployVerifier__factory.connect(verifier, provider);
      } else {
        verifierContract = IRelayVerifier__factory.connect(verifier, provider);
      }
    } catch (e) {
      const error = e as Error;
      let message = `unknown verifier error: ${error.message}`;
      if (
        error.message.includes(
          "Returned values aren't valid, did it run Out of Gas?"
        )
      ) {
        message = `incompatible verifier contract: ${verifier}`;
      } else if (error.message.includes('no code at address')) {
        message = `'non-existent verifier contract: ${verifier}`;
      }
      throw new Error(message);
    }

    try {
      let verifyMethod: PopulatedTransaction;
      if (isDeployTransaction(envelopingTransaction)) {
        verifyMethod = await (
          verifierContract as IDeployVerifier
        ).populateTransaction.verifyRelayedCall(
          envelopingTransaction.relayRequest,
          envelopingTransaction.metadata.signature,
          { from: this.workerAddress }
        );
      } else {
        verifyMethod = await (
          verifierContract as IRelayVerifier
        ).populateTransaction.verifyRelayedCall(
          envelopingTransaction.relayRequest as RelayRequest,
          envelopingTransaction.metadata.signature
        );
      }
      await provider.call(verifyMethod, 'pending');
    } catch (e) {
      const error = e as Error;
      throw new Error(`Verification by verifier failed: ${error.message}`);
    }
  }

  async getMaxPossibleGas(
    envelopingTransaction: EnvelopingTxRequest
  ): Promise<MaxPossibleGas> {
    log.debug(
      `Enveloping transaction: ${JSON.stringify(
        envelopingTransaction,
        undefined,
        4
      )}`
    );

    // TODO: For RIF team
    // Here the server has the last chance to compare the maxPossibleGas the deploy transaction needs with
    // the aggreement signed between the client and the relayer. Take this into account during the Arbiter integration

    // Actual maximum gas needed to  send the relay transaction
    const initialGasEstimation = await standardMaxPossibleGasEstimation(
      envelopingTransaction,
      this.workerAddress
    );
    log.debug(
      `Gas estimation before fees:  ${initialGasEstimation.toString()}`
    );

    const fee = await calculateFee(
      envelopingTransaction.relayRequest,
      initialGasEstimation,
      this.config.app
    );
    log.debug(`Total fees expressed in gas: ${fee.toString()}`);

    return {
      maxPossibleGas: initialGasEstimation,
      maxPossibleGasWithFee: initialGasEstimation.add(
        fee.toFixed(0).toString()
      ),
    };
  }

  async maxPossibleGasWithViewCall(
    transaction: PopulatedTransaction,
    envelopingRequest: EnvelopingTxRequest,
    gasLimit: BigNumber
  ): Promise<BigNumber> {
    log.debug('Relay Server - Request sent to the worker');
    log.debug('Relay Server - req: ', envelopingRequest);

    const {
      relayRequest: {
        relayData: { gasPrice },
      },
    } = envelopingRequest;

    log.debug('RelayServer - attempting to relay transaction');

    const { maxPossibleGas } = await maxPossibleGasVerification(
      transaction,
      gasPrice as BigNumberish,
      gasLimit,
      this.workerAddress
    );

    return maxPossibleGas;
  }

  async estimateMaxPossibleGas(
    envelopingRequest: EnvelopingTxRequest
  ): Promise<RelayEstimation> {
    log.debug(
      `EnvelopingRequest:${JSON.stringify(envelopingRequest, undefined, 4)}`
    );

    const initialGasEstimation = await estimateRelayMaxPossibleGas(
      envelopingRequest,
      this.workerAddress
    );
    log.debug(
      `Gas estimation before fees:  ${initialGasEstimation.toString()}`
    );

    const fee = await calculateFee(
      envelopingRequest.relayRequest,
      initialGasEstimation,
      this.config.app
    );

    log.debug(`Total fees expressed in gas: ${fee.toString()}`);

    const maxPossibleGas = BigNumber.from(
      fee.plus(initialGasEstimation.toString()).toFixed(0)
    );

    log.debug(
      `Final gas estimation including fees: ${maxPossibleGas.toString()}`
    );

    const conversionResult = await convertGasToTokenAndNative(
      envelopingRequest.relayRequest,
      maxPossibleGas
    );
    log.debug(
      'Final estimation:',
      JSON.stringify(conversionResult, undefined, 4)
    );

    return {
      gasPrice: conversionResult.gasPrice,
      estimation: conversionResult.value,
      requiredTokenAmount: conversionResult.valueInToken,
      requiredNativeAmount: conversionResult.valueInNative,
      exchangeRate: conversionResult.exchangeRate,
    };
  }

  async createRelayTransaction(
    envelopingTransaction: EnvelopingTxRequest
  ): Promise<SignedTransactionDetails> {
    log.debug(`dump request params: ${JSON.stringify(envelopingTransaction)}`);
    if (!this.isReady()) {
      throw new Error('relay not ready');
    }
    this.validateInputTypes(envelopingTransaction);

    const {
      blockchain: { minAlertedDelayMS, maxAlertedDelayMS },
    } = this.config;

    if (this._alerted) {
      log.error('Alerted state: slowing down traffic');
      await sleep(randomInRange(minAlertedDelayMS, maxAlertedDelayMS));
    }
    await this.validateInput(envelopingTransaction);
    await this.validateMaxNonce(
      envelopingTransaction.metadata.relayMaxNonce.toString()
    );

    await this.validateRequestWithVerifier(envelopingTransaction);

    await validateIfGasAmountIsAcceptable(envelopingTransaction);

    const { maxPossibleGas, maxPossibleGasWithFee } =
      await this.getMaxPossibleGas(envelopingTransaction);

    // Send relayed transaction
    log.debug('maxPossibleGas is', maxPossibleGas.toString());

    await validateIfTokenAmountIsAcceptable(
      maxPossibleGasWithFee,
      envelopingTransaction,
      this.config.app
    );

    const relayHub = getRelayHub();

    const {
      relayRequest,
      metadata: { signature },
    } = envelopingTransaction;

    const method = isDeployRequest(relayRequest)
      ? await relayHub.populateTransaction.deployCall(relayRequest, signature)
      : await relayHub.populateTransaction.relayCall(
          relayRequest as RelayRequest,
          signature
        );

    // Call relayCall as a view function to see if we'll get paid for relaying this tx
    const maxPossibleGasWithViewCall = await this.maxPossibleGasWithViewCall(
      method,
      envelopingTransaction,
      maxPossibleGas
    );

    log.debug(
      'maxPossibleGasWithViewCall is',
      maxPossibleGasWithViewCall.toString()
    );

    const provider = getProvider();

    const currentBlock = await provider.getBlockNumber();
    const details: SendTransactionDetails = {
      signer: this.workerAddress,
      serverAction: ServerAction.RELAY_CALL,
      method,
      destination: envelopingTransaction.metadata.relayHubAddress.toString(),
      gasLimit: maxPossibleGasWithViewCall,
      creationBlockNumber: currentBlock,
      gasPrice: BigNumber.from(
        envelopingTransaction.relayRequest.relayData.gasPrice
      ),
    };
    const txDetails = await this.transactionManager.sendTransaction(details);
    // after sending a transaction is a good time to check the worker's balance, and replenish it.
    await this.replenishServer(0, currentBlock);

    return txDetails;
  }

  async intervalHandler(): Promise<void> {
    const {
      app: { devMode, readyTimeout },
    } = this.config;
    const now = Date.now();
    let workerTimeout: Timeout;
    if (!devMode) {
      workerTimeout = setTimeout(() => {
        const timedOut = Date.now() - now;
        log.warn(chalk.bgRedBright(`Relay state: Timed-out after ${timedOut}`));

        this._lastSuccessfulRounds = 0;
      }, readyTimeout);
    }

    const provider = getProvider();

    return new Promise<void>((resolve, reject) => {
      provider
        .getBlock('latest')
        .then((block) => {
          if (block.number > this._lastScannedBlock) {
            resolve(this._workerSemaphore.bind(this)(block.number));
          }
        })
        .catch((e) => {
          this.emit('error', e);
          const error = e as Error;
          log.error(`error in worker: ${error.message} ${error.stack ?? ''}`);
          this._lastSuccessfulRounds = 0;
          reject(error);
        })
        .finally(() => {
          clearTimeout(workerTimeout);
        });
    });
  }

  start(): void {
    const {
      app: { checkInterval },
    } = this.config;
    log.debug(`Started polling for new blocks every ${checkInterval}ms`);
    this._workerTask = setInterval(
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      this.intervalHandler.bind(this),
      checkInterval
    );
  }

  stop(): void {
    if (this._workerTask == null) {
      throw new Error('Server not started');
    }
    clearInterval(this._workerTask);
    log.info('Successfully stopped polling!!');
  }

  async _workerSemaphore(blockNumber: number): Promise<void> {
    if (this._workerSemaphoreOn) {
      log.warn('Different worker is not finished yet, skipping this block');

      return;
    }
    this._workerSemaphoreOn = true;

    await this._worker(blockNumber)
      .then((transactions) => {
        this._lastSuccessfulRounds++;

        if (transactions.length !== 0) {
          log.debug(
            `Done handling block #${blockNumber}. Created ${transactions.length} transactions.`
          );
        }
      })
      .finally(() => {
        this._workerSemaphoreOn = false;
      });
  }

  fatal(message: string): void {
    log.error('FATAL: ' + message);
    process.exit(1);
  }

  /***
   * initialize data from trusted verifiers.
   * "Trusted" verifiers means that:
   * - we trust verifyRelayedCall to be consistent: off-chain call and on-chain calls should either both succeed
   *    or both revert.
   *
   * @param verifiers list of trusted verifiers addresses
   */
  _initTrustedVerifiers(verifiers: string[] = []): void {
    const {
      contracts: { relayVerifierAddress, deployVerifierAddress },
    } = this.config;
    this.trustedVerifiers.clear();
    for (const verifierAddress of verifiers) {
      this.trustedVerifiers.add(verifierAddress.toLowerCase());
    }
    if (
      relayVerifierAddress !== constants.AddressZero &&
      !this.trustedVerifiers.has(relayVerifierAddress.toLowerCase())
    ) {
      this.trustedVerifiers.add(relayVerifierAddress.toLowerCase());
    }
    if (
      deployVerifierAddress !== constants.AddressZero &&
      !this.trustedVerifiers.has(deployVerifierAddress.toLowerCase())
    ) {
      this.trustedVerifiers.add(deployVerifierAddress.toLowerCase());
    }
  }

  async init(): Promise<void> {
    if (this._initialized) {
      throw new Error('_init was already called');
    }
    log.debug('Relay Server - Relay Server initializing');
    log.debug('Relay Server - Transaction Manager initialized');
    const {
      contracts: { relayHubAddress, trustedVerifiers },
      blockchain: { initialBlockToScan },
    } = this.config;
    this._initTrustedVerifiers(trustedVerifiers);
    log.debug(`Relay Server - Relay hub: ${relayHubAddress}`);
    const code = await isContractDeployed(relayHubAddress);
    if (!code) {
      this.fatal(`No RelayHub deployed at address ${relayHubAddress}.`);
    }

    this.registrationManager = new RegistrationManager(
      this.transactionManager,
      this.txStoreManager,
      this,
      this.managerAddress,
      this.workerAddress
    );
    await this.registrationManager.init(initialBlockToScan);
    log.debug('Relay Server - Registration manager initialized');

    const provider = getProvider() as providers.JsonRpcProvider;

    const { chainId } = await provider.getNetwork();
    const networkId = Number(await provider.send('net_version', []));

    this.chainId = chainId;
    this.networkId = networkId;
    log.debug(`Relay Server - chainId: ${this.chainId}`);
    log.debug(`Relay Server - networkId: ${this.networkId}`);

    /* TODO CHECK against RSK ChainId
    if (this.config.devMode && (this.chainId < 1000 || this.networkId < 1000)) {
      log.error('Don\'t use real network\'s chainId & networkId while in devMode.')
      process.exit(-1)
    }
    */

    const latestBlock = await provider.getBlock('latest');
    log.info(`Current network info:
chainId                 | ${this.chainId}
networkId               | ${this.networkId}
latestBlock             | ${latestBlock.number}
latestBlock timestamp   | ${latestBlock.timestamp}
`);
    this._initialized = true;

    // Assume started server is not registered until _worker figures stuff out
    this.registrationManager.printNotRegisteredMessage();
  }

  /**
   * It withdraws excess balance from the relayHub to the relayManager, and refills the relayWorker with
   * balance if required.
   * @param workerIndex Not used so it can be any number
   * @param currentBlock Where to place the replenish action
   */

  async replenishServer(
    workerIndex: number,
    currentBlock: number
  ): Promise<string[]> {
    return await replenishStrategy(this, workerIndex, currentBlock);
  }

  async _worker(blockNumber: number): Promise<string[]> {
    if (!this._initialized) {
      await this.init();
    }
    if (blockNumber <= this._lastScannedBlock) {
      throw new Error('Attempt to scan older block, aborting');
    }
    if (!this._shouldRefreshState(blockNumber)) {
      return [];
    }
    this._lastRefreshBlock = blockNumber;
    await this._refreshGasPrice();
    await this.registrationManager.refreshBalance();
    if (!this.registrationManager.balanceRequired.isSatisfied) {
      this.setReadyState(false);

      return [];
    }

    return await this._handleChanges(blockNumber);
  }

  async _refreshGasPrice(): Promise<void> {
    const provider = getProvider();

    this.gasPrice = await provider.getGasPrice();
    if (this.gasPrice.eq(constants.Zero)) {
      throw new Error('Could not get gasPrice from node');
    }
  }

  async _handleChanges(currentBlockNumber: number): Promise<string[]> {
    let transactionHashes: string[] = [];
    // TODO: we get all the events since last scan looking for
    // (RelayServerRegistered,RelayWorkersAdded,TransactionRelayed,TransactionRelayedButRevertedByRecipient)
    const hubEventsSinceLastScan = await this.getAllHubEventsSinceLastScan();
    await this._updateLatestTxBlockNumber(hubEventsSinceLastScan);
    const shouldRegisterAgain = await this._shouldRegisterAgain(
      currentBlockNumber,
      hubEventsSinceLastScan
    );
    transactionHashes = transactionHashes.concat(
      // TODO: we get all the events since last scan looking for
      // (StakeAdded, StakeUnlocked, StakeWithdrawn)
      await this.registrationManager.handlePastEvents(
        hubEventsSinceLastScan,
        this._lastScannedBlock,
        currentBlockNumber,
        shouldRegisterAgain
      )
    );
    await this.transactionManager.removeConfirmedTransactions(
      currentBlockNumber
    );
    await this._boostStuckPendingTransactions(currentBlockNumber);
    this._lastScannedBlock = currentBlockNumber;
    const isRegistered = this.registrationManager.isRegistered();
    if (!isRegistered) {
      this.setReadyState(false);

      return transactionHashes;
    }
    this.handlePastHubEvents(currentBlockNumber, hubEventsSinceLastScan);
    const workerIndex = 0;
    transactionHashes = transactionHashes.concat(
      await this.replenishServer(workerIndex, currentBlockNumber)
    );
    const {
      blockchain: { workerMinBalance, alertedBlockDelay },
    } = this.config;
    const workerBalance = await this.getWorkerBalance(workerIndex);
    if (workerBalance.lt(workerMinBalance)) {
      this.setReadyState(false);

      return transactionHashes;
    }
    this.setReadyState(true);
    if (
      this._alerted &&
      this.alertedBlock + alertedBlockDelay < currentBlockNumber
    ) {
      log.warn(
        `Relay exited alerted state. Alerted block: ${this.alertedBlock}. Current block number: ${currentBlockNumber}`
      );
      this._alerted = false;
    }

    return transactionHashes;
  }

  async getManagerBalance(): Promise<BigNumber> {
    const provider = getProvider();

    return await provider.getBalance(this.managerAddress, 'pending');
  }

  async getWorkerBalance(workerIndex: number): Promise<BigNumber> {
    const provider = getProvider();
    log.debug('getWorkerBalance: workerIndex', workerIndex);

    return await provider.getBalance(this.workerAddress, 'pending');
  }

  async _shouldRegisterAgain(
    currentBlock: number,
    hubEventsSinceLastScan: TypedEvent[]
  ): Promise<boolean> {
    const {
      blockchain: { registrationBlockRate },
    } = this.config;
    log.debug(
      '_shouldRegisterAgain: hubEventsSinceLastScan',
      hubEventsSinceLastScan
    );
    const isPendingActivityTransaction =
      (await this.txStoreManager.isActionPending(ServerAction.RELAY_CALL)) ||
      (await this.txStoreManager.isActionPending(ServerAction.REGISTER_SERVER));
    if (registrationBlockRate === 0 || isPendingActivityTransaction) {
      log.debug(
        `_shouldRegisterAgain returns false isPendingActivityTransaction=${isPendingActivityTransaction.toString()} registrationBlockRate=${registrationBlockRate}`
      );

      return false;
    }
    const latestTxBlockNumber = this._getLatestTxBlockNumber();
    const registrationExpired =
      currentBlock - latestTxBlockNumber >= registrationBlockRate;
    if (!registrationExpired) {
      log.debug(
        `_shouldRegisterAgain registrationExpired=${registrationExpired.toString()} currentBlock=${currentBlock} latestTxBlockNumber=${latestTxBlockNumber} registrationBlockRate=${registrationBlockRate}`
      );
    }

    return registrationExpired;
  }

  _shouldRefreshState(currentBlock: number): boolean {
    const {
      blockchain: { refreshStateTimeoutBlocks },
    } = this.config;

    return (
      currentBlock - this._lastRefreshBlock >= refreshStateTimeoutBlocks ||
      !this.isReady()
    );
  }

  handlePastHubEvents(
    currentBlockNumber: number,
    hubEventsSinceLastScan: TypedEvent[]
  ): void {
    for (const event of hubEventsSinceLastScan) {
      switch (event.event) {
        case 'TransactionRelayedButRevertedByRecipient':
          log.debug(
            'handle TransactionRelayedButRevertedByRecipient event',
            event
          );
          this._handleTransactionRelayedButRevertedByRecipientEvent(
            currentBlockNumber
          );
          break;
        case 'TransactionRelayed':
          log.debug(
            `handle TransactionRelayed event: ${JSON.stringify(event)}`
          );
          this._handleTransactionRelayedEvent(event);
          break;
      }
    }
  }

  async getAllHubEventsSinceLastScan(): Promise<Array<TypedEvent>> {
    const options = {
      fromBlock: this._lastScannedBlock + 1,
      toBlock: 'latest',
    };
    const events = await getPastEventsForHub(this.managerAddress, options);
    if (events.length !== 0) {
      log.debug(`Found ${events.length} events since last scan`);
    }

    return events;
  }

  _handleTransactionRelayedEvent(event: TypedEvent): void {
    // Here put anything that needs to be performed after a Transaction gets relayed
    log.debug('_handleTransactionRelayedEvent: event', event);
  }

  _handleTransactionRelayedButRevertedByRecipientEvent(
    blockNumber: number
  ): void {
    this._alerted = true;
    this.alertedBlock = blockNumber;
    log.error(`Relay entered alerted state. Block number: ${blockNumber}`);
  }

  _getLatestTxBlockNumber(): number {
    return this.lastMinedActiveTransaction?.blockNumber ?? -1;
  }

  async _updateLatestTxBlockNumber(
    eventsSinceLastScan: Array<TypedEvent>
  ): Promise<void> {
    const latestTransactionSinceLastScan =
      getLatestEventData(eventsSinceLastScan);
    if (latestTransactionSinceLastScan != null) {
      this.lastMinedActiveTransaction = latestTransactionSinceLastScan;
      log.debug(
        `found newer block ${this.lastMinedActiveTransaction?.blockNumber}`
      );
    }
    if (this.lastMinedActiveTransaction == null) {
      this.lastMinedActiveTransaction = await this._queryLatestActiveEvent();
      log.debug(
        `queried node for last active server event, found in block ${
          this.lastMinedActiveTransaction?.blockNumber ?? 0
        }`
      );
    }
  }

  async _queryLatestActiveEvent(): Promise<TypedEvent | undefined> {
    const {
      blockchain: { initialBlockToScan },
    } = this.config;
    const events: Array<TypedEvent> = await getPastEventsForHub(
      this.managerAddress,
      {
        fromBlock: initialBlockToScan,
      }
    );

    return getLatestEventData(events);
  }

  /**
   * Resend all outgoing pending transactions with insufficient gas price by all signers (manager, workers)
   * @return the mapping of the previous transaction hash to details of a new boosted transaction
   */
  async _boostStuckPendingTransactions(
    blockNumber: number
  ): Promise<Map<string, SignedTransactionDetails>> {
    const transactionDetails = new Map<string, SignedTransactionDetails>();
    // repeat separately for each signer (manager, all workers)
    const managerBoostedTransactions =
      await this._boostStuckTransactionsForManager(blockNumber);
    for (const [txHash, boostedTxDetails] of managerBoostedTransactions) {
      transactionDetails.set(txHash, boostedTxDetails);
    }
    for (const workerIndex of [0]) {
      const workerBoostedTransactions =
        await this._boostStuckTransactionsForWorker(blockNumber, workerIndex);
      for (const [txHash, boostedTxDetails] of workerBoostedTransactions) {
        transactionDetails.set(txHash, boostedTxDetails);
      }
    }

    return transactionDetails;
  }

  async _boostStuckTransactionsForManager(
    blockNumber: number
  ): Promise<Map<string, SignedTransactionDetails>> {
    return await this.transactionManager.boostUnderpricedPendingTransactionsForSigner(
      this.managerAddress,
      blockNumber
    );
  }

  async _boostStuckTransactionsForWorker(
    blockNumber: number,
    workerIndex: number
  ): Promise<Map<string, SignedTransactionDetails>> {
    log.debug('_boostStuckTransactionsForWorker: workerIndex', workerIndex);
    const signer = this.workerAddress;

    return await this.transactionManager.boostUnderpricedPendingTransactionsForSigner(
      signer,
      blockNumber
    );
  }

  isTrustedVerifier(verifier: string): boolean {
    return this.trustedVerifiers.has(verifier.toLowerCase());
  }

  isReady(): boolean {
    const {
      blockchain: { successfulRoundsForReady },
    } = this.config;
    if (this._lastSuccessfulRounds < successfulRoundsForReady) {
      return false;
    }

    return this._ready;
  }

  setReadyState(isReady: boolean): void {
    const {
      blockchain: { successfulRoundsForReady },
    } = this.config;

    if (this.isReady() !== isReady) {
      if (isReady) {
        if (this._lastSuccessfulRounds < successfulRoundsForReady) {
          const roundsUntilReady =
            successfulRoundsForReady - this._lastSuccessfulRounds;
          log.warn(
            chalk.yellow(
              `Relayer state: almost READY (in ${roundsUntilReady} rounds)`
            )
          );
        } else {
          log.warn(chalk.greenBright('Relayer state: READY'));
        }
      } else {
        log.warn(chalk.redBright('Relayer state: NOT-READY'));
      }
    }
    this._ready = isReady;
  }
}
