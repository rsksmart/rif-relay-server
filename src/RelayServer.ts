import chalk from 'chalk';
import log from 'loglevel';
import {
  TokenHandler__factory,
  IDeployVerifier__factory,
  IRelayVerifier__factory,
  IDeployVerifier,
  IRelayVerifier,
  ERC20__factory,
} from '@rsksmart/rif-relay-contracts';
import type {
  EnvelopingTypes,
  TypedEvent,
} from '@rsksmart/rif-relay-contracts';
import {
  ContractInteractor,
  RelayTransactionRequest,
  DeployTransactionRequest,
  deployTransactionRequestShape,
  relayTransactionRequestShape,
  MAX_ESTIMATED_GAS_DEVIATION,
  // VersionsManager
} from '@rsksmart/rif-relay-common';
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
  configureServer,
  ServerDependencies,
  ServerConfigParams,
  ContractsConfig,
  AppConfig,
  BlockchainConfig,
} from './ServerConfigParams';
import Timeout = NodeJS.Timeout;
import EventEmitter from 'events';
import config from 'config';
import {
  utils,
  constants,
  Event,
  PopulatedTransaction,
  BigNumberish,
  BigNumber,
} from 'ethers';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import ow from 'ow';
import { getLatestEventData, randomInRange, sleep } from './Utils';
import { AmountRequired } from './AmountRequired';
import { INSUFFICIENT_TOKEN_AMOUNT } from './definitions/errorMessages.const';
import {
  convertGasToNative,
  convertGasToToken,
  getXRateFor,
  parseToBigNumber,
  toNativeWeiFrom,
} from './Conversions';
import type ExchangeToken from './definitions/token.type';
import { estimateRelayMaxPossibleGas } from './GasEstimator';

const VERSION = '2.0.1';
const INITIAL_FACTOR_TO_TRY = 0.25;
const LIMIT_MAX_FACTOR_TO_TRY = 2;

type PingResponse = {
  relayWorkerAddress: string;
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

const calculateFeeValue = (
  maxPossibleGas: BigNumberish,
  feePercentage: BigNumberish
): BigNumber => {
  const bigMaxPossibleGas = BigNumberJs(maxPossibleGas.toString());
  const bigFeePercentage = BigNumberJs(feePercentage.toString());

  return parseToBigNumber(bigMaxPossibleGas.multipliedBy(bigFeePercentage));
};

export type RelayEstimation = {
  gasPrice: string;
  estimation: string;
  requiredTokenAmount: string;
  requiredNativeAmount: string;
  exchangeRate: string;
};

export class RelayServer extends EventEmitter {
  private lastScannedBlock = 0;

  private lastRefreshBlock = 0;

  private ready = false;

  private lastSuccessfulRounds = Number.MAX_SAFE_INTEGER;

  readonly managerAddress: string;

  readonly workerAddress: string;

  readonly feesReceiver: string;

  gasPrice = BigNumber.from(0);

  _workerSemaphoreOn = false;

  private alerted = false;

  alertedBlock = 0;

  private _initialized = false;

  readonly contractInteractor: ContractInteractor;

  // private readonly versionManager: VersionsManager;

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

  private readonly customReplenish: boolean;

  constructor(dependencies: ServerDependencies) {
    super();
    const contractsConfig: ContractsConfig = config.get('contracts');
    const appConfig: AppConfig = config.get('app');
    const blockchainConfig: BlockchainConfig = config.get('blockchain');
    // this.versionManager = new VersionsManager(VERSION);
    this.config = configureServer(contractsConfig, appConfig, blockchainConfig);
    this.contractInteractor = dependencies.contractInteractor;
    this.txStoreManager = dependencies.txStoreManager;
    this.transactionManager = new TransactionManager(dependencies, this.config);
    this.managerAddress =
      this.transactionManager.managerKeyManager.getAddress(0) ?? '';
    this.workerAddress =
      this.transactionManager.workersKeyManager.getAddress(0) ?? '';
    this.feesReceiver =
      this.config.contracts.feesReceiver === constants.AddressZero
        ? this.workerAddress
        : this.config.contracts.feesReceiver;
    this.customReplenish = this.config.app.customReplenish;
    this.workerBalanceRequired = new AmountRequired(
      'Worker Balance',
      BigNumber.from(this.config.blockchain.workerMinBalance)
    );
    this.printServerAddresses();

    log.warn('RelayServer version', VERSION);
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
    return this.customReplenish;
  }

  pingHandler(): PingResponse {
    return {
      relayWorkerAddress: this.workerAddress,
      relayManagerAddress: this.managerAddress,
      relayHubAddress: this.contractInteractor.relayHub.address,
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
    for (const verifier of verifiersToQuery) {
      const tokenHandlerInstance = TokenHandler__factory.connect(
        verifier,
        this.contractInteractor.provider
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

  isDeployRequest(
    req: RelayTransactionRequest | DeployTransactionRequest
  ): boolean {
    return 'index' in req.relayRequest.request;
  }

  validateInputTypes(
    req: RelayTransactionRequest | DeployTransactionRequest
  ): void {
    if (this.isDeployRequest(req)) {
      ow(req, ow.object.exactShape(deployTransactionRequestShape));
    } else {
      ow(req, ow.object.exactShape(relayTransactionRequestShape));
    }
  }

  validateInput(req: RelayTransactionRequest | DeployTransactionRequest): void {
    // Check that the relayHub is the correct one
    if (
      req.metadata.relayHubAddress.toLowerCase() !==
      this.contractInteractor.relayHub.address.toLowerCase()
    ) {
      throw new Error(
        `Wrong hub address.\nRelay server's hub address: ${this.contractInteractor.relayHub.address}, request's hub address: ${req.metadata.relayHubAddress}\n`
      );
    }

    const feesReceiver = req.relayRequest.relayData.feesReceiver as string;
    // Check the relayWorker (todo: once migrated to multiple relays, check if exists)
    if (feesReceiver.toLowerCase() !== this.feesReceiver.toLowerCase()) {
      throw new Error(`Wrong fees receiver address: ${feesReceiver}\n`);
    }

    const gasPrice = req.relayRequest.relayData.gasPrice.toString();
    // Check that the gasPrice is initialized & acceptable
    if (this.gasPrice.gt(gasPrice)) {
      throw new Error(
        `Unacceptable gasPrice: relayServer's gasPrice:${this.gasPrice.toString()} request's gasPrice: ${gasPrice}`
      );
    }
  }

  validateVerifier(
    req: RelayTransactionRequest | DeployTransactionRequest
  ): void {
    const callVerifier = req.relayRequest.relayData.callVerifier as string;
    if (!this.isTrustedVerifier(callVerifier)) {
      throw new Error(`Invalid verifier: ${callVerifier}`);
    }
  }

  async validateMaxNonce(relayMaxNonce: number): Promise<void> {
    // Check that max nonce is valid
    const nonce = await this.transactionManager.pollNonce(this.workerAddress);
    if (nonce > relayMaxNonce) {
      throw new Error(
        `Unacceptable relayMaxNonce: ${relayMaxNonce}. current nonce: ${nonce}`
      );
    }
  }

  async validateRequestWithVerifier(
    req: RelayTransactionRequest | DeployTransactionRequest
  ): Promise<{ maxPossibleGas: BigNumber }> {
    const verifier = req.relayRequest.relayData.callVerifier as string;

    if (!this.isTrustedVerifier(verifier)) {
      throw new Error('Invalid verifier');
    }

    let verifierContract: IRelayVerifier | IDeployVerifier;
    const isDeployRequest: boolean = this.isDeployRequest(req);

    try {
      if (isDeployRequest) {
        verifierContract = IDeployVerifier__factory.connect(
          verifier,
          this.contractInteractor.provider
        );
      } else {
        verifierContract = IRelayVerifier__factory.connect(
          verifier,
          this.contractInteractor.provider
        );
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

    const maxPossibleGas = await this.getMaxPossibleGas(req, isDeployRequest);

    try {
      let verifyMethod: PopulatedTransaction;
      if (this.isDeployRequest(req)) {
        verifyMethod = await (
          verifierContract as IRelayVerifier
        ).populateTransaction.verifyRelayedCall(
          (req as RelayTransactionRequest).relayRequest,
          req.metadata.signature,
          { from: this.workerAddress }
        );
      } else {
        verifyMethod = await (
          verifierContract as IDeployVerifier
        ).populateTransaction.verifyRelayedCall(
          (req as DeployTransactionRequest).relayRequest,
          req.metadata.signature
        );
      }
      await this.contractInteractor.provider.call(verifyMethod, 'pending');
    } catch (e) {
      const error = e as Error;
      throw new Error(`Verification by verifier failed: ${error.message}`);
    }

    return { maxPossibleGas };
  }

  async getMaxPossibleGas(
    req: RelayTransactionRequest | DeployTransactionRequest,
    isDeployRequest: boolean
  ): Promise<BigNumber> {
    let maxPossibleGas: BigNumber;

    log.debug('RequestFees - request data:', JSON.stringify(req, undefined, 4));

    if (isDeployRequest) {
      const deployReq = req as DeployTransactionRequest;
      // Actual Maximum gas needed to send to the deploy request tx
      maxPossibleGas =
        await this.contractInteractor.walletFactoryEstimateGasOfDeployCall(
          deployReq,
          this.workerAddress
        );

      // TODO: For RIF team
      // Here the server has the last chance to compare the maxPossibleGas the deploy transaction needs with
      // the aggreement signed between the client and the relayer. Take this into account during the Arbiter integration.
    } else {
      const relayReq = req as RelayTransactionRequest;

      // TODO: For RIF Team
      // The maxPossibleGas must be compared against the commitment signed with the user.
      // The relayServer must not allow a call that requires more gas than it was agreed with the user
      // For now, we can call estimateDestinationContractCallGas to get the "ACTUAL" gas required for the
      // field req.relayRequest.request.gas and not relay requests that deviated too much from what the user signed

      // But take into acconunt that the aggreement with the user (the one from the Arbiter) has the final decision.
      // If the Relayer agreeed with the Client a certain percentage of deviation from the original maxGas, then it must honor that agreement
      // and not the current hardcoded deviation

      const estimatedDesinationGasCost: BigNumber =
        await this.contractInteractor.estimateDestinationContractCallGas({
          from: relayReq.relayRequest.relayData.callForwarder as string,
          to: relayReq.relayRequest.request.to as string,
          gasPrice: relayReq.relayRequest.relayData.gasPrice.toString(),
          data: relayReq.relayRequest.request.data.toString(),
        });

      const bigMaxEstimatedGasDeviation = BigNumberJs(
        MAX_ESTIMATED_GAS_DEVIATION
      );
      const bigOne = BigNumberJs('1');
      const bigGasFromRequest = BigNumberJs(
        relayReq.relayRequest.request.gas.toString()
      );
      const bigGasFromRequestMaxAgreed = bigMaxEstimatedGasDeviation
        .plus(bigOne)
        .multipliedBy(bigGasFromRequest);

      if (
        estimatedDesinationGasCost.gt(bigGasFromRequestMaxAgreed.toString())
      ) {
        throw new Error(
          "Request payload's gas parameters deviate too much fom the estimated gas for this transaction"
        );
      }

      // Actual maximum gas needed to  send the relay transaction
      maxPossibleGas =
        await this.contractInteractor.estimateRelayTransactionMaxPossibleGasWithTransactionRequest(
          relayReq,
          this.workerAddress
        );
    }

    if (!this.isSponsorshipAllowed(req.relayRequest)) {
      const { feePercentage } = this.config.app;

      log.debug(`RelayServer - feePercentage: ${feePercentage}`);

      const feeValue: BigNumber = calculateFeeValue(
        maxPossibleGas,
        feePercentage
      );

      const bigFee = BigNumberJs(feeValue.toString());

      maxPossibleGas = parseToBigNumber(bigFee.plus(maxPossibleGas.toString()));

      const tokenAmount = req.relayRequest.request.tokenAmount.toString();
      const gasPrice = BigNumberJs(
        req.relayRequest.relayData.gasPrice.toString()
      );

      const tokenInstance = ERC20__factory.connect(
        req.relayRequest.request.tokenContract as string,
        this.contractInteractor.provider
      );

      const token: ExchangeToken = {
        instance: tokenInstance,
        name: await tokenInstance.name(),
        symbol: await tokenInstance.symbol(),
        decimals: await tokenInstance.decimals(),
      };

      const xRate = await getXRateFor(token);

      const tokenAmountInNative: BigNumber = toNativeWeiFrom({
        ...token,
        amount: tokenAmount,
        xRate,
      });

      const bigTokenInNative = BigNumberJs(tokenAmountInNative.toString());

      const tokenAmountInGas: BigNumberJs =
        bigTokenInNative.dividedBy(gasPrice);

      const isTokenAmountAcceptable: boolean =
        tokenAmountInGas.isGreaterThanOrEqualTo(maxPossibleGas.toString());

      log.debug(
        'RequestFees - isTokenAmountAcceptable? ',
        isTokenAmountAcceptable
      );

      if (!isTokenAmountAcceptable) {
        log.warn(
          'TokenAmount in gas agreed by the user',
          tokenAmountInGas.toString()
        );
        log.warn(
          'MaxPossibleGas including fees required by the transaction',
          maxPossibleGas.toString()
        );
        throw new Error(INSUFFICIENT_TOKEN_AMOUNT);
      }
      log.debug(
        `RequestFees - total max possible gas: ${maxPossibleGas.toString()}`
      );
    }

    return maxPossibleGas;
  }

  isSponsorshipAllowed(
    req:
      | EnvelopingTypes.RelayRequestStruct
      | EnvelopingTypes.DeployRequestStruct
  ): boolean {
    const { disableSponsoredTx, sponsoredDestinations } = this.config.app;

    return (
      !disableSponsoredTx ||
      sponsoredDestinations.includes(req.request.to as string)
    );
  }

  async validateViewCallSucceeds(
    transaction: PopulatedTransaction,
    req: RelayTransactionRequest | DeployTransactionRequest,
    maxPossibleGas: BigNumber
  ): Promise<void> {
    log.debug('Relay Server - Request sent to the worker');
    log.debug('Relay Server - req: ', req);
    try {
      await this.contractInteractor.provider.call(
        {
          ...transaction,
          from: this.workerAddress,
          gasPrice: req.relayRequest.relayData.gasPrice,
          gasLimit: maxPossibleGas.toString(),
        },
        'pending'
      );
    } catch (e) {
      throw new Error(
        `relayCall (local call) reverted in server: ${(e as Error).message}`
      );
    }
  }

  async estimateMaxPossibleGas(
    req: RelayTransactionRequest | DeployTransactionRequest
  ): Promise<RelayEstimation> {
    const {
      relayData: { gasPrice },
    } = req.relayRequest;

    let estimation = await estimateRelayMaxPossibleGas(
      this.contractInteractor.provider,
      req,
      this.workerAddress
    );

    if (!this.isSponsorshipAllowed(req.relayRequest)) {
      const { feePercentage } = this.config.app;

      log.debug(`RelayServer - feePercentage: ${feePercentage}`);

      const feeValue: BigNumber = calculateFeeValue(
        estimation.toString(),
        feePercentage
      );

      const bigFee = BigNumberJs(feeValue.toString());

      estimation = parseToBigNumber(bigFee.plus(estimation.toString()));
    }

    const tokenInstance = ERC20__factory.connect(
      req.relayRequest.request.tokenContract as string,
      this.contractInteractor.provider
    );

    const token: ExchangeToken = {
      instance: tokenInstance,
      name: await tokenInstance.name(),
      symbol: await tokenInstance.symbol(),
      decimals: await tokenInstance.decimals(),
    };

    const xRate = await getXRateFor(token);

    const requiredTokenAmount = convertGasToToken(
      estimation,
      { ...token, xRate },
      gasPrice.toString()
    );

    const requiredNativeAmount = convertGasToNative(
      estimation,
      gasPrice.toString()
    );

    return {
      estimation: estimation.toString(),
      requiredTokenAmount: requiredTokenAmount.toString(),
      requiredNativeAmount: requiredNativeAmount.toString(),
      exchangeRate: xRate,
      gasPrice: gasPrice.toString(),
    };
  }

  async createRelayTransaction(
    req: RelayTransactionRequest | DeployTransactionRequest
  ): Promise<SignedTransactionDetails> {
    log.debug(`dump request params: ${JSON.stringify(req)}`);
    if (!this.isReady()) {
      throw new Error('relay not ready');
    }
    this.validateInputTypes(req);

    if (this.alerted) {
      log.error('Alerted state: slowing down traffic');
      await sleep(
        randomInRange(
          this.config.blockchain.minAlertedDelayMS,
          this.config.blockchain.maxAlertedDelayMS
        )
      );
    }
    this.validateInput(req);
    await this.validateMaxNonce(req.metadata.relayMaxNonce);

    const { maxPossibleGas } = await this.validateRequestWithVerifier(req);

    // Send relayed transaction
    log.debug('maxPossibleGas is', maxPossibleGas.toString());

    const isDeploy = this.isDeployRequest(req);

    const method = isDeploy
      ? await this.contractInteractor.relayHub.populateTransaction.deployCall(
          req.relayRequest as EnvelopingTypes.DeployRequestStruct,
          req.metadata.signature
        )
      : await this.contractInteractor.relayHub.populateTransaction.relayCall(
          req.relayRequest as EnvelopingTypes.RelayRequestStruct,
          req.metadata.signature
        );

    // Call relayCall as a view function to see if we'll get paid for relaying this tx
    await this.validateViewCallSucceeds(method, req, maxPossibleGas);
    const currentBlock = await this.contractInteractor.getBlockNumber();
    const details: SendTransactionDetails = {
      signer: this.workerAddress,
      serverAction: ServerAction.RELAY_CALL,
      method,
      destination: req.metadata.relayHubAddress,
      gasLimit: maxPossibleGas,
      creationBlockNumber: currentBlock,
      gasPrice: req.relayRequest.relayData.gasPrice as BigNumber,
    };
    const txDetails = await this.transactionManager.sendTransaction(details);
    // after sending a transaction is a good time to check the worker's balance, and replenish it.
    await this.replenishServer(0, currentBlock);

    return txDetails;
  }

  async intervalHandler(): Promise<void> {
    const now = Date.now();
    let workerTimeout: Timeout;
    if (!this.config.app.devMode) {
      workerTimeout = setTimeout(() => {
        const timedOut = Date.now() - now;
        log.warn(chalk.bgRedBright(`Relay state: Timed-out after ${timedOut}`));

        this.lastSuccessfulRounds = 0;
      }, this.config.app.readyTimeout);
    }

    return new Promise<void>((resolve, reject) => {
      this.contractInteractor
        .getBlock('latest')
        .then((block) => {
          if (block.number > this.lastScannedBlock) {
            resolve(this._workerSemaphore.bind(this)(block.number));
          }
        })
        .catch((e) => {
          this.emit('error', e);
          const error = e as Error;
          log.error(`error in worker: ${error.message} ${error.stack ?? ''}`);
          this.lastSuccessfulRounds = 0;
          reject(error);
        })
        .finally(() => {
          clearTimeout(workerTimeout);
        });
    });
  }

  start(): void {
    log.debug(
      `Started polling for new blocks every ${this.config.app.checkInterval}ms`
    );
    this._workerTask = setInterval(
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      this.intervalHandler.bind(this),
      this.config.app.checkInterval
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
        this.lastSuccessfulRounds++;

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
    this.trustedVerifiers.clear();
    for (const verifierAddress of verifiers) {
      this.trustedVerifiers.add(verifierAddress.toLowerCase());
    }
    if (
      this.config.contracts.relayVerifierAddress !== constants.AddressZero &&
      !this.trustedVerifiers.has(
        this.config.contracts.relayVerifierAddress.toLowerCase()
      )
    ) {
      this.trustedVerifiers.add(
        this.config.contracts.relayVerifierAddress.toLowerCase()
      );
    }
    if (
      this.config.contracts.deployVerifierAddress !== constants.AddressZero &&
      !this.trustedVerifiers.has(
        this.config.contracts.deployVerifierAddress.toLowerCase()
      )
    ) {
      this.trustedVerifiers.add(
        this.config.contracts.deployVerifierAddress.toLowerCase()
      );
    }
  }

  async init(): Promise<void> {
    if (this._initialized) {
      throw new Error('_init was already called');
    }
    log.debug('Relay Server - Relay Server initializing');
    log.debug('Relay Server - Transaction Manager initialized');
    this._initTrustedVerifiers(this.config.contracts.trustedVerifiers);
    const relayHubAddress = this.contractInteractor.relayHub.address;
    log.debug(`Relay Server - Relay hub: ${relayHubAddress}`);
    const code = await this.contractInteractor.isContractDeployed(
      relayHubAddress
    );
    if (!code) {
      this.fatal(`No RelayHub deployed at address ${relayHubAddress}.`);
    }

    this.registrationManager = new RegistrationManager(
      this.contractInteractor,
      this.transactionManager,
      this.txStoreManager,
      this,
      this.config,
      this.managerAddress,
      this.workerAddress
    );
    await this.registrationManager.init();
    log.debug('Relay Server - Registration manager initialized');

    const { chainId } = await this.contractInteractor.provider.getNetwork();
    this.chainId = chainId;
    this.networkId = chainId;
    log.debug(`Relay Server - chainId: ${this.chainId}`);
    log.debug(`Relay Server - networkId: ${this.networkId}`);

    /* TODO CHECK against RSK ChainId
    if (this.config.devMode && (this.chainId < 1000 || this.networkId < 1000)) {
      log.error('Don\'t use real network\'s chainId & networkId while in devMode.')
      process.exit(-1)
    }
    */

    const latestBlock = await this.contractInteractor.getBlock('latest');
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
    if (blockNumber <= this.lastScannedBlock) {
      throw new Error('Attempt to scan older block, aborting');
    }
    if (!this._shouldRefreshState(blockNumber)) {
      return [];
    }
    this.lastRefreshBlock = blockNumber;
    await this._refreshGasPrice();
    await this.registrationManager.refreshBalance();
    if (!this.registrationManager.balanceRequired.isSatisfied) {
      this.setReadyState(false);

      return [];
    }

    return await this._handleChanges(blockNumber);
  }

  async _refreshGasPrice(): Promise<void> {
    this.gasPrice = await this.contractInteractor.provider.getGasPrice();
    if (this.gasPrice.eq(constants.Zero)) {
      throw new Error('Could not get gasPrice from node');
    }
  }

  async _handleChanges(currentBlockNumber: number): Promise<string[]> {
    let transactionHashes: string[] = [];
    const hubEventsSinceLastScan = await this.getAllHubEventsSinceLastScan();
    await this._updateLatestTxBlockNumber(hubEventsSinceLastScan);
    const shouldRegisterAgain = await this._shouldRegisterAgain(
      currentBlockNumber,
      hubEventsSinceLastScan
    );
    transactionHashes = transactionHashes.concat(
      await this.registrationManager.handlePastEvents(
        hubEventsSinceLastScan,
        this.lastScannedBlock,
        currentBlockNumber,
        shouldRegisterAgain
      )
    );
    await this.transactionManager.removeConfirmedTransactions(
      currentBlockNumber
    );
    await this._boostStuckPendingTransactions(currentBlockNumber);
    this.lastScannedBlock = currentBlockNumber;
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
    const workerBalance = await this.getWorkerBalance(workerIndex);
    if (workerBalance.lt(this.config.blockchain.workerMinBalance)) {
      this.setReadyState(false);

      return transactionHashes;
    }
    this.setReadyState(true);
    if (
      this.alerted &&
      this.alertedBlock + this.config.blockchain.alertedBlockDelay <
        currentBlockNumber
    ) {
      log.warn(
        `Relay exited alerted state. Alerted block: ${this.alertedBlock}. Current block number: ${currentBlockNumber}`
      );
      this.alerted = false;
    }

    return transactionHashes;
  }

  async getManagerBalance(): Promise<BigNumber> {
    return await this.contractInteractor.getBalance(
      this.managerAddress,
      'pending'
    );
  }

  async getWorkerBalance(workerIndex: number): Promise<BigNumber> {
    log.debug('getWorkerBalance: workerIndex', workerIndex);

    return await this.contractInteractor.getBalance(
      this.workerAddress,
      'pending'
    );
  }

  async _shouldRegisterAgain(
    currentBlock: number,
    hubEventsSinceLastScan: TypedEvent[]
  ): Promise<boolean> {
    log.debug(
      '_shouldRegisterAgain: hubEventsSinceLastScan',
      hubEventsSinceLastScan
    );
    const isPendingActivityTransaction =
      (await this.txStoreManager.isActionPending(ServerAction.RELAY_CALL)) ||
      (await this.txStoreManager.isActionPending(ServerAction.REGISTER_SERVER));
    if (
      this.config.blockchain.registrationBlockRate === 0 ||
      isPendingActivityTransaction
    ) {
      log.debug(
        `_shouldRegisterAgain returns false isPendingActivityTransaction=${isPendingActivityTransaction.toString()} registrationBlockRate=${
          this.config.blockchain.registrationBlockRate
        }`
      );

      return false;
    }
    const latestTxBlockNumber = this._getLatestTxBlockNumber();
    const registrationExpired =
      currentBlock - latestTxBlockNumber >=
      this.config.blockchain.registrationBlockRate;
    if (!registrationExpired) {
      log.debug(
        `_shouldRegisterAgain registrationExpired=${registrationExpired.toString()} currentBlock=${currentBlock} latestTxBlockNumber=${latestTxBlockNumber} registrationBlockRate=${
          this.config.blockchain.registrationBlockRate
        }`
      );
    }

    return registrationExpired;
  }

  _shouldRefreshState(currentBlock: number): boolean {
    return (
      currentBlock - this.lastRefreshBlock >=
        this.config.blockchain.refreshStateTimeoutBlocks || !this.isReady()
    );
  }

  handlePastHubEvents(
    currentBlockNumber: number,
    hubEventsSinceLastScan: TypedEvent[]
  ): void {
    for (const event of hubEventsSinceLastScan) {
      switch (event.event) {
        case 'TransactionRejectedByRecipient':
          log.debug('handle TransactionRejectedByRecipient event', event);
          this._handleTransactionRejectedByRecipientEvent(currentBlockNumber);
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
      fromBlock: this.lastScannedBlock + 1,
      toBlock: 'latest',
    };
    const events = await this.contractInteractor.getPastEventsForHub(
      [this.managerAddress],
      options
    );
    if (events.length !== 0) {
      log.debug(`Found ${events.length} events since last scan`);
    }

    return events;
  }

  _handleTransactionRelayedEvent(event: TypedEvent): void {
    // Here put anything that needs to be performed after a Transaction gets relayed
    log.debug('_handleTransactionRelayedEvent: event', event);
  }

  _handleTransactionRejectedByRecipientEvent(blockNumber: number): void {
    this.alerted = true;
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
    const events: Array<TypedEvent> =
      await this.contractInteractor.getPastEventsForHub([this.managerAddress], {
        fromBlock: 1,
      });

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
    if (
      this.lastSuccessfulRounds <
      this.config.blockchain.successfulRoundsForReady
    ) {
      return false;
    }

    return this.ready;
  }

  setReadyState(isReady: boolean): void {
    if (this.isReady() !== isReady) {
      if (isReady) {
        if (
          this.lastSuccessfulRounds <
          this.config.blockchain.successfulRoundsForReady
        ) {
          const roundsUntilReady =
            this.config.blockchain.successfulRoundsForReady -
            this.lastSuccessfulRounds;
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
    this.ready = isReady;
  }
}
