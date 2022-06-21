"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayServer = void 0;
const chalk_1 = __importDefault(require("chalk"));
const loglevel_1 = __importDefault(require("loglevel"));
const ow_1 = __importDefault(require("ow"));
const web3_utils_1 = require("web3-utils");
const rif_relay_common_1 = require("@rsksmart/rif-relay-common");
const ReplenishFunction_1 = require("./ReplenishFunction");
const RegistrationManager_1 = require("./RegistrationManager");
const TransactionManager_1 = require("./TransactionManager");
const StoredTransaction_1 = require("./StoredTransaction");
const ServerConfigParams_1 = require("./ServerConfigParams");
const ethereumjs_util_1 = require("ethereumjs-util");
const events_1 = __importDefault(require("events"));
const Conversions_1 = require("./Conversions");
const VERSION = '2.0.1';
class RelayServer extends events_1.default {
    constructor(config, dependencies) {
        super();
        this.lastScannedBlock = 0;
        this.lastRefreshBlock = 0;
        this.ready = false;
        this.lastSuccessfulRounds = Number.MAX_SAFE_INTEGER;
        this.gasPrice = 0;
        this._workerSemaphoreOn = false;
        this.alerted = false;
        this.alertedBlock = 0;
        this.initialized = false;
        this.trustedVerifiers = new Set();
        this.versionManager = new rif_relay_common_1.VersionsManager(VERSION);
        this.config = ServerConfigParams_1.configureServer(config);
        this.contractInteractor = dependencies.contractInteractor;
        this.txStoreManager = dependencies.txStoreManager;
        this.transactionManager = new TransactionManager_1.TransactionManager(dependencies, this.config);
        this.managerAddress =
            this.transactionManager.managerKeyManager.getAddress(0);
        this.workerAddress =
            this.transactionManager.workersKeyManager.getAddress(0);
        this.customReplenish = this.config.customReplenish;
        this.workerBalanceRequired = new rif_relay_common_1.AmountRequired('Worker Balance', web3_utils_1.toBN(this.config.workerMinBalance));
        this.printServerAddresses();
        loglevel_1.default.setLevel(this.config.logLevel);
        loglevel_1.default.warn('RelayServer version', VERSION);
        loglevel_1.default.info('Using server configuration:\n', this.config);
    }
    printServerAddresses() {
        loglevel_1.default.info(`Server manager address  | ${this.managerAddress}`);
        loglevel_1.default.info(`Server worker  address  | ${this.workerAddress}`);
    }
    getMinGasPrice() {
        return this.gasPrice;
    }
    isCustomReplenish() {
        return this.customReplenish;
    }
    async pingHandler(verifier) {
        var _a, _b, _c;
        console.debug('Ping handler Verifier', verifier);
        return {
            relayWorkerAddress: this.workerAddress,
            relayManagerAddress: this.managerAddress,
            relayHubAddress: (_b = (_a = this.relayHubContract) === null || _a === void 0 ? void 0 : _a.address) !== null && _b !== void 0 ? _b : '',
            minGasPrice: this.getMinGasPrice().toString(),
            chainId: this.chainId.toString(),
            networkId: this.networkId.toString(),
            ready: (_c = this.isReady()) !== null && _c !== void 0 ? _c : false,
            version: VERSION
        };
    }
    async tokenHandler(verifier) {
        let verifiersToQuery;
        // if a verifier was supplied, check that it is trusted
        if (verifier !== undefined) {
            if (!this.trustedVerifiers.has(verifier.toLowerCase())) {
                throw new Error('supplied verifier is not trusted');
            }
            verifiersToQuery = [verifier];
        }
        else {
            // if no verifier was supplied, query all tursted verifiers
            verifiersToQuery = Array.from(this.trustedVerifiers);
        }
        const res = {};
        for (const verifier of verifiersToQuery) {
            const tokenHandlerInstance = await this.contractInteractor.createTokenHandler(verifier);
            const acceptedTokens = await tokenHandlerInstance.getAcceptedTokens();
            res[ethereumjs_util_1.toChecksumAddress(verifier)] = acceptedTokens;
        }
        return res;
    }
    async verifierHandler() {
        return {
            trustedVerifiers: Array.from(this.trustedVerifiers)
        };
    }
    isDeployRequest(req) {
        let isDeploy = false;
        if (req.relayRequest.request.recoverer !== undefined) {
            isDeploy = true;
        }
        return isDeploy;
    }
    validateInputTypes(req) {
        if (this.isDeployRequest(req)) {
            ow_1.default(req, ow_1.default.object.exactShape(rif_relay_common_1.DeployTransactionRequestShape));
        }
        else {
            ow_1.default(req, ow_1.default.object.exactShape(rif_relay_common_1.RelayTransactionRequestShape));
        }
    }
    validateInput(req) {
        // Check that the relayHub is the correct one
        if (req.metadata.relayHubAddress.toLowerCase() !==
            this.relayHubContract.address.toLowerCase()) {
            throw new Error(`Wrong hub address.\nRelay server's hub address: ${this.relayHubContract.address}, request's hub address: ${req.metadata.relayHubAddress}\n`);
        }
        // Check the relayWorker (todo: once migrated to multiple relays, check if exists)
        if (req.relayRequest.relayData.relayWorker.toLowerCase() !==
            this.workerAddress.toLowerCase()) {
            throw new Error(`Wrong worker address: ${req.relayRequest.relayData.relayWorker}\n`);
        }
        // Check that the gasPrice is initialized & acceptable
        if (this.gasPrice > parseInt(req.relayRequest.relayData.gasPrice)) {
            throw new Error(`Unacceptable gasPrice: relayServer's gasPrice:${this.gasPrice} request's gasPrice: ${req.relayRequest.relayData.gasPrice}`);
        }
    }
    validateVerifier(req) {
        if (!this.isTrustedVerifier(req.relayRequest.relayData.callVerifier)) {
            throw new Error(`Invalid verifier: ${req.relayRequest.relayData.callVerifier}`);
        }
    }
    async validateMaxNonce(relayMaxNonce) {
        // Check that max nonce is valid
        const nonce = await this.transactionManager.pollNonce(this.workerAddress);
        if (nonce > relayMaxNonce) {
            throw new Error(`Unacceptable relayMaxNonce: ${relayMaxNonce}. current nonce: ${nonce}`);
        }
    }
    async validateRequestWithVerifier(req) {
        const verifier = req.relayRequest.relayData.callVerifier;
        if (!this.isTrustedVerifier(verifier)) {
            throw new Error('Invalid verifier');
        }
        let verifierContract;
        const isDeployRequest = this.isDeployRequest(req);
        try {
            if (isDeployRequest) {
                verifierContract =
                    await this.contractInteractor._createDeployVerifier(verifier);
            }
            else {
                verifierContract =
                    await this.contractInteractor._createRelayVerifier(verifier);
            }
        }
        catch (e) {
            const error = e;
            let message = `unknown verifier error: ${error.message}`;
            if (error.message.includes("Returned values aren't valid, did it run Out of Gas?")) {
                message = `incompatible verifier contract: ${verifier}`;
            }
            else if (error.message.includes('no code at address')) {
                message = `'non-existent verifier contract: ${verifier}`;
            }
            throw new Error(message);
        }
        const maxPossibleGas = await this.getMaxPossibleGas(req, isDeployRequest);
        try {
            if (this.isDeployRequest(req)) {
                await verifierContract.contract.methods
                    .verifyRelayedCall(req.relayRequest, req.metadata.signature)
                    .call({ from: this.workerAddress }, 'pending');
            }
            else {
                await verifierContract.contract.methods
                    .verifyRelayedCall(req.relayRequest, req.metadata.signature)
                    .call({ from: this.workerAddress }, 'pending');
            }
        }
        catch (e) {
            const error = e;
            throw new Error(`Verification by verifier failed: ${error.message}`);
        }
        return { maxPossibleGas };
    }
    async getMaxPossibleGas(req, isDeployRequest) {
        let maxPossibleGas;
        if (isDeployRequest) {
            const deployReq = req;
            // Actual Maximum gas needed to send to the deploy request tx
            maxPossibleGas = web3_utils_1.toBN(await this.contractInteractor.walletFactoryEstimateGasOfDeployCall(deployReq));
            // TODO: For RIF team
            // Here the server has the last chance to compare the maxPossibleGas the deploy transaction needs with
            // the agreement signed between the client and the relayer. Take this into account during the Arbiter integration.
        }
        else {
            const relayReq = req;
            // TODO: For RIF Team
            // The maxPossibleGas must be compared against the commitment signed with the user.
            // The relayServer must not allow a call that requires more gas than what it was agreed with the user.
            // For now, we can call estimateDestinationContractCallGas to get the "ACTUAL" gas required for the
            // field req.relayRequest.request.gas and not relay requests that deviated too much from what the user signed
            // But take into account that the agreement with the user (the one from the Arbiter) has the final decision.
            // If the Relayer agreed with the Client a certain percentage of deviation from the original maxGas, then it must honor that agreement
            // and not the current hardcoded deviation
            const estimatedDestinationGasCost = await this.contractInteractor.estimateDestinationContractCallGas({
                from: relayReq.relayRequest.relayData.callForwarder,
                to: relayReq.relayRequest.request.to,
                gasPrice: relayReq.relayRequest.relayData.gasPrice,
                data: relayReq.relayRequest.request.data
            });
            const gasFromRequest = web3_utils_1.toBN(relayReq.relayRequest.request.gas).toNumber();
            const gasFromRequestMaxAgreed = Math.ceil(gasFromRequest * (1 + rif_relay_common_1.constants.MAX_ESTIMATED_GAS_DEVIATION));
            if (estimatedDestinationGasCost > gasFromRequestMaxAgreed) {
                throw new Error("Request payload's gas parameters deviate too much fom the estimated gas for this transaction");
            }
            // Actual maximum gas needed to  send the relay transaction
            maxPossibleGas = web3_utils_1.toBN(await this.contractInteractor.estimateRelayTransactionMaxPossibleGasWithTransactionRequest(relayReq));
        }
        loglevel_1.default.debug('RequestFees - allowForSponsoredTx ', this.config.allowForSponsoredTx);
        if (!this.config.allowForSponsoredTx) {
            // we need to convert tokenAmount back into RBTC and compare its value with maxPossibleGas
            // if the value is lower than maxPossibleGas, we should throw an error
            // TODO: we may need add some percentage fee at some point.
            const tokenAmountInGas = Conversions_1.getGas(Conversions_1.getRBTCWeiFromRifWei(web3_utils_1.toBN(req.relayRequest.request.tokenAmount)), web3_utils_1.toBN(req.relayRequest.relayData.gasPrice));
            const isTokenAmountAcceptable = tokenAmountInGas.gte(maxPossibleGas);
            loglevel_1.default.debug('RequestFees - isTokenAmountAcceptable? ', isTokenAmountAcceptable);
            if (!isTokenAmountAcceptable) {
                loglevel_1.default.warn('TokenAmount in gas agreed by the user', tokenAmountInGas.toString());
                loglevel_1.default.warn('MaxPossibleGas required by the transaction', maxPossibleGas.toString());
                throw new Error('User agreed to spend lower than what the transaction may require.');
            }
        }
        return maxPossibleGas;
    }
    async validateViewCallSucceeds(method, req, maxPossibleGas) {
        loglevel_1.default.debug('Relay Server - Request sent to the worker');
        loglevel_1.default.debug('Relay Server - req: ', req);
        try {
            await method.call({
                from: this.workerAddress,
                gasPrice: req.relayRequest.relayData.gasPrice,
                gas: maxPossibleGas.toString()
            }, 'pending');
        }
        catch (e) {
            throw new Error(`relayCall (local call) reverted in server: ${e.message}`);
        }
    }
    async createRelayTransaction(req) {
        loglevel_1.default.debug(`dump request params: ${JSON.stringify(req)}`);
        if (!this.isReady()) {
            throw new Error('relay not ready');
        }
        this.validateInputTypes(req);
        if (this.alerted) {
            loglevel_1.default.error('Alerted state: slowing down traffic');
            await rif_relay_common_1.sleep(rif_relay_common_1.randomInRange(this.config.minAlertedDelayMS, this.config.maxAlertedDelayMS));
        }
        this.validateInput(req);
        await this.validateMaxNonce(req.metadata.relayMaxNonce);
        const { maxPossibleGas } = await this.validateRequestWithVerifier(req);
        // Send relayed transaction
        loglevel_1.default.debug('maxPossibleGas is', maxPossibleGas.toString());
        const isDeploy = this.isDeployRequest(req);
        const method = isDeploy
            ? this.relayHubContract.contract.methods.deployCall(req.relayRequest, req.metadata.signature)
            : this.relayHubContract.contract.methods.relayCall(req.relayRequest, req.metadata.signature);
        // Call relayCall as a view function to see if we'll get paid for relaying this tx
        await this.validateViewCallSucceeds(method, req, maxPossibleGas);
        const currentBlock = await this.contractInteractor.getBlockNumber();
        const details = {
            signer: this.workerAddress,
            serverAction: StoredTransaction_1.ServerAction.RELAY_CALL,
            method,
            destination: req.metadata.relayHubAddress,
            gasLimit: maxPossibleGas.toNumber(),
            creationBlockNumber: currentBlock,
            gasPrice: req.relayRequest.relayData.gasPrice
        };
        const txDetails = await this.transactionManager.sendTransaction(details);
        // after sending a transaction is a good time to check the worker's balance, and replenish it.
        await this.replenishServer(0, currentBlock);
        return txDetails;
    }
    async intervalHandler() {
        const now = Date.now();
        let workerTimeout;
        if (!this.config.devMode) {
            workerTimeout = setTimeout(() => {
                const timedOut = Date.now() - now;
                loglevel_1.default.warn(chalk_1.default.bgRedBright(`Relay state: Timed-out after ${timedOut}`));
                this.lastSuccessfulRounds = 0;
            }, this.config.readyTimeout);
        }
        return new Promise((resolve, reject) => {
            this.contractInteractor
                .getBlock('latest')
                .then((block) => {
                if (block.number > this.lastScannedBlock) {
                    resolve(this._workerSemaphore.bind(this)(block.number));
                }
            })
                .catch((e) => {
                this.emit('error', e);
                const error = e;
                loglevel_1.default.error(`error in worker: ${error.message} ${error.stack}`);
                this.lastSuccessfulRounds = 0;
                reject(error);
            })
                .finally(() => {
                clearTimeout(workerTimeout);
            });
        });
    }
    start() {
        loglevel_1.default.debug(`Started polling for new blocks every ${this.config.checkInterval}ms`);
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        this.workerTask = setInterval(this.intervalHandler.bind(this), this.config.checkInterval);
    }
    stop() {
        if (this.workerTask == null) {
            throw new Error('Server not started');
        }
        clearInterval(this.workerTask);
        loglevel_1.default.info('Successfully stopped polling!!');
    }
    async _workerSemaphore(blockNumber) {
        if (this._workerSemaphoreOn) {
            loglevel_1.default.warn('Different worker is not finished yet, skipping this block');
            return;
        }
        this._workerSemaphoreOn = true;
        await this._worker(blockNumber)
            .then((transactions) => {
            this.lastSuccessfulRounds++;
            if (transactions.length !== 0) {
                loglevel_1.default.debug(`Done handling block #${blockNumber}. Created ${transactions.length} transactions.`);
            }
        })
            .finally(() => {
            this._workerSemaphoreOn = false;
        });
    }
    fatal(message) {
        loglevel_1.default.error('FATAL: ' + message);
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
    async _initTrustedVerifiers(verifiers = []) {
        this.trustedVerifiers.clear();
        for (const verifierAddress of verifiers) {
            this.trustedVerifiers.add(verifierAddress.toLowerCase());
        }
        if (this.config.relayVerifierAddress !== rif_relay_common_1.constants.ZERO_ADDRESS &&
            !this.trustedVerifiers.has(this.config.relayVerifierAddress.toLowerCase())) {
            this.trustedVerifiers.add(this.config.relayVerifierAddress.toLowerCase());
        }
        if (this.config.deployVerifierAddress !== rif_relay_common_1.constants.ZERO_ADDRESS &&
            !this.trustedVerifiers.has(this.config.deployVerifierAddress.toLowerCase())) {
            this.trustedVerifiers.add(this.config.deployVerifierAddress.toLowerCase());
        }
    }
    async init() {
        if (this.initialized) {
            throw new Error('_init was already called');
        }
        loglevel_1.default.debug('Relay Server - Relay Server initializing');
        await this.transactionManager._init();
        loglevel_1.default.debug('Relay Server - Transaction Manager initialized');
        await this._initTrustedVerifiers(this.config.trustedVerifiers);
        this.relayHubContract = this.contractInteractor.relayHubInstance;
        const relayHubAddress = this.relayHubContract.address;
        loglevel_1.default.debug(`Relay Server - Relay hub: ${relayHubAddress}`);
        const code = await this.contractInteractor.getCode(relayHubAddress);
        if (code.length < 10) {
            this.fatal(`No RelayHub deployed at address ${relayHubAddress}.`);
        }
        this.registrationManager = new RegistrationManager_1.RegistrationManager(this.contractInteractor, this.transactionManager, this.txStoreManager, this, this.config, this.managerAddress, this.workerAddress);
        await this.registrationManager.init();
        loglevel_1.default.debug('Relay Server - Registration manager initialized');
        this.chainId = this.contractInteractor.getChainId();
        this.networkId = this.contractInteractor.getNetworkId();
        loglevel_1.default.debug(`Relay Server - chainId: ${this.chainId}`);
        loglevel_1.default.debug(`Relay Server - networkId: ${this.networkId}`);
        /* TODO CHECK against RSK ChainId
    if (this.config.devMode && (this.chainId < 1000 || this.networkId < 1000)) {
      log.error('Don\'t use real network\'s chainId & networkId while in devMode.')
      process.exit(-1)
    }
    */
        const latestBlock = await this.contractInteractor.getBlock('latest');
        loglevel_1.default.info(`Current network info:
chainId                 | ${this.chainId}
networkId               | ${this.networkId}
latestBlock             | ${latestBlock.number}
latestBlock timestamp   | ${latestBlock.timestamp}
`);
        this.initialized = true;
        // Assume started server is not registered until _worker figures stuff out
        this.registrationManager.printNotRegisteredMessage();
    }
    /**
     * It withdraws excess balance from the relayHub to the relayManager, and refills the relayWorker with
     * balance if required.
     * @param workerIndex Not used so it can be any number
     * @param currentBlock Where to place the replenish action
     */
    async replenishServer(workerIndex, currentBlock) {
        return await ReplenishFunction_1.replenishStrategy(this, workerIndex, currentBlock);
    }
    async _worker(blockNumber) {
        if (!this.initialized) {
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
    async _refreshGasPrice() {
        const gasPriceString = await this.contractInteractor.getGasPrice();
        this.gasPrice = Math.floor(parseInt(gasPriceString) * this.config.gasPriceFactor);
        if (this.gasPrice === 0) {
            throw new Error('Could not get gasPrice from node');
        }
    }
    async _handleChanges(currentBlockNumber) {
        let transactionHashes = [];
        const hubEventsSinceLastScan = await this.getAllHubEventsSinceLastScan();
        await this._updateLatestTxBlockNumber(hubEventsSinceLastScan);
        const shouldRegisterAgain = await this._shouldRegisterAgain(currentBlockNumber, hubEventsSinceLastScan);
        transactionHashes = transactionHashes.concat(await this.registrationManager.handlePastEvents(hubEventsSinceLastScan, this.lastScannedBlock, currentBlockNumber, shouldRegisterAgain));
        await this.transactionManager.removeConfirmedTransactions(currentBlockNumber);
        await this._boostStuckPendingTransactions(currentBlockNumber);
        this.lastScannedBlock = currentBlockNumber;
        const isRegistered = await this.registrationManager.isRegistered();
        if (!isRegistered) {
            this.setReadyState(false);
            return transactionHashes;
        }
        await this.handlePastHubEvents(currentBlockNumber, hubEventsSinceLastScan);
        const workerIndex = 0;
        transactionHashes = transactionHashes.concat(await this.replenishServer(workerIndex, currentBlockNumber));
        const workerBalance = await this.getWorkerBalance(workerIndex);
        if (workerBalance.lt(web3_utils_1.toBN(this.config.workerMinBalance))) {
            this.setReadyState(false);
            return transactionHashes;
        }
        this.setReadyState(true);
        if (this.alerted &&
            this.alertedBlock + this.config.alertedBlockDelay <
                currentBlockNumber) {
            loglevel_1.default.warn(`Relay exited alerted state. Alerted block: ${this.alertedBlock}. Current block number: ${currentBlockNumber}`);
            this.alerted = false;
        }
        return transactionHashes;
    }
    async getManagerBalance() {
        return web3_utils_1.toBN(await this.contractInteractor.getBalance(this.managerAddress, 'pending'));
    }
    async getWorkerBalance(workerIndex) {
        console.debug('getWorkerBalance: workerIndex', workerIndex);
        return web3_utils_1.toBN(await this.contractInteractor.getBalance(this.workerAddress, 'pending'));
    }
    async _shouldRegisterAgain(currentBlock, hubEventsSinceLastScan) {
        console.debug('_shouldRegisterAgain: hubEventsSinceLastScan', hubEventsSinceLastScan);
        const isPendingActivityTransaction = (await this.txStoreManager.isActionPending(StoredTransaction_1.ServerAction.RELAY_CALL)) ||
            (await this.txStoreManager.isActionPending(StoredTransaction_1.ServerAction.REGISTER_SERVER));
        if (this.config.registrationBlockRate === 0 ||
            isPendingActivityTransaction) {
            loglevel_1.default.debug(`_shouldRegisterAgain returns false isPendingActivityTransaction=${isPendingActivityTransaction} registrationBlockRate=${this.config.registrationBlockRate}`);
            return false;
        }
        const latestTxBlockNumber = this._getLatestTxBlockNumber();
        const registrationExpired = currentBlock - latestTxBlockNumber >=
            this.config.registrationBlockRate;
        if (!registrationExpired) {
            loglevel_1.default.debug(`_shouldRegisterAgain registrationExpired=${registrationExpired} currentBlock=${currentBlock} latestTxBlockNumber=${latestTxBlockNumber} registrationBlockRate=${this.config.registrationBlockRate}`);
        }
        return registrationExpired;
    }
    _shouldRefreshState(currentBlock) {
        return (currentBlock - this.lastRefreshBlock >=
            this.config.refreshStateTimeoutBlocks || !this.isReady());
    }
    async handlePastHubEvents(currentBlockNumber, hubEventsSinceLastScan) {
        for (const event of hubEventsSinceLastScan) {
            switch (event.event) {
                case rif_relay_common_1.TransactionRejectedByRecipient:
                    loglevel_1.default.debug('handle TransactionRejectedByRecipient event', event);
                    await this._handleTransactionRejectedByRecipientEvent(currentBlockNumber);
                    break;
                case rif_relay_common_1.TransactionRelayed:
                    loglevel_1.default.debug(`handle TransactionRelayed event: ${JSON.stringify(event)}`);
                    await this._handleTransactionRelayedEvent(event);
                    break;
            }
        }
    }
    async getAllHubEventsSinceLastScan() {
        const topics = [rif_relay_common_1.address2topic(this.managerAddress)];
        const options = {
            fromBlock: this.lastScannedBlock + 1,
            toBlock: 'latest'
        };
        const events = await this.contractInteractor.getPastEventsForHub(topics, options);
        if (events.length !== 0) {
            loglevel_1.default.debug(`Found ${events.length} events since last scan`);
        }
        return events;
    }
    async _handleTransactionRelayedEvent(event) {
        // Here put anything that needs to be performed after a Transaction gets relayed
        console.debug('_handleTransactionRelayedEvent: event', event);
    }
    async _handleTransactionRejectedByRecipientEvent(blockNumber) {
        this.alerted = true;
        this.alertedBlock = blockNumber;
        loglevel_1.default.error(`Relay entered alerted state. Block number: ${blockNumber}`);
    }
    _getLatestTxBlockNumber() {
        var _a, _b;
        return (_b = (_a = this.lastMinedActiveTransaction) === null || _a === void 0 ? void 0 : _a.blockNumber) !== null && _b !== void 0 ? _b : -1;
    }
    async _updateLatestTxBlockNumber(eventsSinceLastScan) {
        var _a, _b;
        const latestTransactionSinceLastScan = rif_relay_common_1.getLatestEventData(eventsSinceLastScan);
        if (latestTransactionSinceLastScan != null) {
            this.lastMinedActiveTransaction = latestTransactionSinceLastScan;
            loglevel_1.default.debug(`found newer block ${(_a = this.lastMinedActiveTransaction) === null || _a === void 0 ? void 0 : _a.blockNumber}`);
        }
        if (this.lastMinedActiveTransaction == null) {
            this.lastMinedActiveTransaction =
                await this._queryLatestActiveEvent();
            loglevel_1.default.debug(`queried node for last active server event, found in block ${(_b = this.lastMinedActiveTransaction) === null || _b === void 0 ? void 0 : _b.blockNumber}`);
        }
    }
    async _queryLatestActiveEvent() {
        const events = await this.contractInteractor.getPastEventsForHub([rif_relay_common_1.address2topic(this.managerAddress)], {
            fromBlock: 1
        });
        return rif_relay_common_1.getLatestEventData(events);
    }
    /**
     * Resend all outgoing pending transactions with insufficient gas price by all signers (manager, workers)
     * @return the mapping of the previous transaction hash to details of a new boosted transaction
     */
    async _boostStuckPendingTransactions(blockNumber) {
        const transactionDetails = new Map();
        // repeat separately for each signer (manager, all workers)
        const managerBoostedTransactions = await this._boostStuckTransactionsForManager(blockNumber);
        for (const [txHash, boostedTxDetails] of managerBoostedTransactions) {
            transactionDetails.set(txHash, boostedTxDetails);
        }
        for (const workerIndex of [0]) {
            const workerBoostedTransactions = await this._boostStuckTransactionsForWorker(blockNumber, workerIndex);
            for (const [txHash, boostedTxDetails] of workerBoostedTransactions) {
                transactionDetails.set(txHash, boostedTxDetails);
            }
        }
        return transactionDetails;
    }
    async _boostStuckTransactionsForManager(blockNumber) {
        return await this.transactionManager.boostUnderpricedPendingTransactionsForSigner(this.managerAddress, blockNumber);
    }
    async _boostStuckTransactionsForWorker(blockNumber, workerIndex) {
        console.debug('_boostStuckTransactionsForWorker: workerIndex', workerIndex);
        const signer = this.workerAddress;
        return await this.transactionManager.boostUnderpricedPendingTransactionsForSigner(signer, blockNumber);
    }
    isTrustedVerifier(verifier) {
        return this.trustedVerifiers.has(verifier.toLowerCase());
    }
    isReady() {
        if (this.lastSuccessfulRounds < this.config.successfulRoundsForReady) {
            return false;
        }
        return this.ready;
    }
    setReadyState(isReady) {
        if (this.isReady() !== isReady) {
            if (isReady) {
                if (this.lastSuccessfulRounds <
                    this.config.successfulRoundsForReady) {
                    const roundsUntilReady = this.config.successfulRoundsForReady -
                        this.lastSuccessfulRounds;
                    loglevel_1.default.warn(chalk_1.default.yellow(`Relayer state: almost READY (in ${roundsUntilReady} rounds)`));
                }
                else {
                    loglevel_1.default.warn(chalk_1.default.greenBright('Relayer state: READY'));
                }
            }
            else {
                loglevel_1.default.warn(chalk_1.default.redBright('Relayer state: NOT-READY'));
            }
        }
        this.ready = isReady;
    }
}
exports.RelayServer = RelayServer;
//# sourceMappingURL=RelayServer.js.map