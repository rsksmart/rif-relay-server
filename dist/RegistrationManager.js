"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegistrationManager = void 0;
const loglevel_1 = __importDefault(require("loglevel"));
const web3_utils_1 = require("web3-utils");
const rif_relay_common_1 = require("@rsksmart/rif-relay-common");
const StoredTransaction_1 = require("./StoredTransaction");
const chalk_1 = __importDefault(require("chalk"));
const mintxgascost = rif_relay_common_1.defaultEnvironment.mintxgascost;
class RegistrationManager {
    constructor(contractInteractor, transactionManager, txStoreManager, eventEmitter, config, 
    // exposed from key manager?
    managerAddress, workerAddress) {
        this._isStakeLocked = false;
        this.isInitialized = false;
        this.delayedEvents = [];
        const listener = () => {
            this.printNotRegisteredMessage();
        };
        this.balanceRequired = new rif_relay_common_1.AmountRequired('Balance', web3_utils_1.toBN(config.managerMinBalance), listener);
        this.stakeRequired = new rif_relay_common_1.AmountRequired('Stake', web3_utils_1.toBN(config.managerMinStake), listener);
        this.contractInteractor = contractInteractor;
        this.hubAddress = config.relayHubAddress;
        this.managerAddress = managerAddress;
        this.workerAddress = workerAddress;
        this.eventEmitter = eventEmitter;
        this.transactionManager = transactionManager;
        this.txStoreManager = txStoreManager;
        this.config = config;
    }
    get isStakeLocked() {
        return this._isStakeLocked;
    }
    set isStakeLocked(newValue) {
        const oldValue = this._isStakeLocked;
        this._isStakeLocked = newValue;
        if (newValue !== oldValue) {
            loglevel_1.default.info(`Manager stake is ${newValue ? 'now' : 'no longer'} locked`);
            this.printNotRegisteredMessage();
        }
    }
    async init() {
        if (this.lastWorkerAddedTransaction == null) {
            this.lastWorkerAddedTransaction =
                await this._queryLatestWorkerAddedEvent();
        }
        this.isInitialized = true;
    }
    async handlePastEvents(hubEventsSinceLastScan, lastScannedBlock, currentBlock, forceRegistration) {
        if (!this.isInitialized) {
            throw new Error('RegistrationManager not initialized');
        }
        const topics = [rif_relay_common_1.address2topic(this.managerAddress)];
        const options = {
            fromBlock: lastScannedBlock + 1,
            toBlock: 'latest'
        };
        const eventNames = [rif_relay_common_1.StakeAdded, rif_relay_common_1.StakeUnlocked, rif_relay_common_1.StakeWithdrawn];
        const decodedEvents = await this.contractInteractor.getPastEventsForStakeManagement(eventNames, topics, options);
        this.printEvents(decodedEvents, options);
        let transactionHashes = [];
        // TODO: what about 'penalize' events? should send balance to owner, I assume
        for (const eventData of decodedEvents) {
            switch (eventData.event) {
                case rif_relay_common_1.StakeAdded:
                    await this.refreshStake();
                    break;
                case rif_relay_common_1.StakeUnlocked:
                    await this.refreshStake();
                    this.delayedEvents.push({
                        block: eventData.returnValues.withdrawBlock.toString(),
                        eventData
                    });
                    break;
                case rif_relay_common_1.StakeWithdrawn:
                    await this.refreshStake();
                    transactionHashes = transactionHashes.concat(await this._handleStakeWithdrawnEvent(eventData, currentBlock));
                    break;
            }
        }
        this.relayData = await this.getRelayData();
        for (const eventData of hubEventsSinceLastScan) {
            switch (eventData.event) {
                case rif_relay_common_1.RelayWorkersAdded:
                    if (this.lastWorkerAddedTransaction == null ||
                        rif_relay_common_1.isSecondEventLater(this.lastWorkerAddedTransaction, eventData)) {
                        this.lastWorkerAddedTransaction = eventData;
                    }
                    break;
            }
        }
        // handle HubUnauthorized only after the due time
        for (const eventData of this._extractDuePendingEvents(currentBlock)) {
            switch (eventData.event) {
                case rif_relay_common_1.StakeUnlocked:
                    transactionHashes = transactionHashes.concat(await this._handleStakeUnlockedEvent(eventData, currentBlock));
                    break;
            }
        }
        const isRegistrationCorrect = await this._isRegistrationCorrect();
        const isRegistrationPending = await this.txStoreManager.isActionPending(StoredTransaction_1.ServerAction.REGISTER_SERVER);
        if (!(isRegistrationPending || isRegistrationCorrect) ||
            forceRegistration) {
            transactionHashes = transactionHashes.concat(await this.attemptRegistration(currentBlock));
        }
        return transactionHashes;
    }
    async getRelayData() {
        const relayData = await this.contractInteractor.getRelayInfo(new Set([this.managerAddress]));
        if (relayData.length > 1) {
            throw new Error('More than one relay manager found for ' + this.managerAddress);
        }
        if (relayData.length == 1) {
            return relayData[0];
        }
        throw new Error('No relay manager found for ' + this.managerAddress);
    }
    _extractDuePendingEvents(currentBlock) {
        const ret = this.delayedEvents
            .filter((event) => event.block <= currentBlock)
            .map((e) => e.eventData);
        this.delayedEvents = [
            ...this.delayedEvents.filter((event) => event.block > currentBlock)
        ];
        return ret;
    }
    _isRegistrationCorrect() {
        return rif_relay_common_1.isRegistrationValid(this.relayData, this.config, this.managerAddress);
    }
    _parseEvent(event) {
        if ((event === null || event === void 0 ? void 0 : event.events) === undefined) {
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            return `not event: ${event === null || event === void 0 ? void 0 : event.toString()}`;
        }
        const args = {};
        // event arguments is for some weird reason give as ".events"
        for (const eventArgument of event.events) {
            args[eventArgument.name] = eventArgument.value;
        }
        return {
            name: event.name,
            address: event.address,
            args: args
        };
    }
    async _handleStakeWithdrawnEvent(dlog, currentBlock) {
        loglevel_1.default.warn('Handling StakeWithdrawn event:', dlog);
        return await this.withdrawAllFunds(true, currentBlock);
    }
    async _handleStakeUnlockedEvent(dlog, currentBlock) {
        loglevel_1.default.warn('Handling StakeUnlocked event:', dlog);
        return await this.withdrawAllFunds(false, currentBlock);
    }
    /**
     * @param withdrawManager - whether to send the relay manager's balance to the owner.
     *        Note that more than one relay process could be using the same manager account.
     * @param currentBlock
     */
    async withdrawAllFunds(withdrawManager, currentBlock) {
        let transactionHashes = [];
        transactionHashes = transactionHashes.concat(await this._sendWorkersEthBalancesToOwner(currentBlock));
        if (withdrawManager) {
            transactionHashes = transactionHashes.concat(await this._sendManagerEthBalanceToOwner(currentBlock));
        }
        this.eventEmitter.emit('unstaked');
        return transactionHashes;
    }
    async refreshBalance() {
        const currentBalance = await this.contractInteractor.getBalance(this.managerAddress);
        this.balanceRequired.currentValue = web3_utils_1.toBN(currentBalance);
    }
    async refreshStake() {
        const stakeInfo = await this.contractInteractor.getStakeInfo(this.managerAddress);
        const stake = web3_utils_1.toBN(stakeInfo.stake);
        if (stake.eq(web3_utils_1.toBN(0))) {
            return;
        }
        // a locked stake does not have the 'withdrawBlock' field set
        this.isStakeLocked = stakeInfo.withdrawBlock === '0';
        this.stakeRequired.currentValue = stake;
        // first time getting stake, setting owner
        if (this.ownerAddress == null) {
            this.ownerAddress = stakeInfo.owner;
            loglevel_1.default.info('Got staked for the first time');
            this.printNotRegisteredMessage();
        }
    }
    async addRelayWorker(currentBlock) {
        // register on chain
        const addRelayWorkerMethod = await this.contractInteractor.getAddRelayWorkersMethod([
            this.workerAddress
        ]);
        const gasLimit = await this.transactionManager.attemptEstimateGas('AddRelayWorkers', addRelayWorkerMethod, this.managerAddress);
        const details = {
            signer: this.managerAddress,
            gasLimit,
            serverAction: StoredTransaction_1.ServerAction.ADD_WORKER,
            method: addRelayWorkerMethod,
            destination: this.hubAddress,
            creationBlockNumber: currentBlock
        };
        const { transactionHash } = await this.transactionManager.sendTransaction(details);
        return transactionHash;
    }
    // TODO: extract worker registration sub-flow
    async attemptRegistration(currentBlock) {
        const allPrerequisitesOk = this.isStakeLocked &&
            this.stakeRequired.isSatisfied &&
            this.balanceRequired.isSatisfied;
        if (!allPrerequisitesOk) {
            loglevel_1.default.info('Not all prerequisites for registration are met yet. Registration attempt cancelled');
            return [];
        }
        let transactions = [];
        // add worker only if not already added
        const workersAdded = this._isWorkerValid();
        const addWorkersPending = await this.txStoreManager.isActionPending(StoredTransaction_1.ServerAction.ADD_WORKER);
        if (!(workersAdded || addWorkersPending)) {
            const txHash = await this.addRelayWorker(currentBlock);
            transactions = transactions.concat(txHash);
        }
        const portIncluded = this.config.url.indexOf(':') > 0;
        const registerUrl = this.config.url +
            (!portIncluded && this.config.port > 0
                ? ':' + this.config.port.toString()
                : '');
        const registerMethod = await this.contractInteractor.getRegisterRelayMethod(registerUrl);
        const gasLimit = await this.transactionManager.attemptEstimateGas('RegisterRelay', registerMethod, this.managerAddress);
        const details = {
            serverAction: StoredTransaction_1.ServerAction.REGISTER_SERVER,
            gasLimit,
            signer: this.managerAddress,
            method: registerMethod,
            destination: this.hubAddress,
            creationBlockNumber: currentBlock
        };
        const { transactionHash } = await this.transactionManager.sendTransaction(details);
        transactions = transactions.concat(transactionHash);
        loglevel_1.default.debug(`Relay ${this.managerAddress} registered on hub ${this.hubAddress}. `);
        return transactions;
    }
    async _sendManagerEthBalanceToOwner(currentBlock) {
        const gasPrice = await this.contractInteractor.getGasPrice();
        const transactionHashes = [];
        const gasLimit = mintxgascost;
        const txCost = web3_utils_1.toBN(gasLimit).mul(web3_utils_1.toBN(gasPrice));
        const managerBalance = web3_utils_1.toBN(await this.contractInteractor.getBalance(this.managerAddress));
        // sending manager RBTC balance to owner
        if (managerBalance.gte(txCost)) {
            loglevel_1.default.info(`Sending manager RBTC balance ${managerBalance.toString()} to owner`);
            const details = {
                signer: this.managerAddress,
                serverAction: StoredTransaction_1.ServerAction.VALUE_TRANSFER,
                destination: this.ownerAddress,
                gasLimit,
                gasPrice,
                value: web3_utils_1.toHex(managerBalance.sub(txCost)),
                creationBlockNumber: currentBlock
            };
            const { transactionHash } = await this.transactionManager.sendTransaction(details);
            transactionHashes.push(transactionHash);
        }
        else {
            loglevel_1.default.error(`manager balance too low: ${managerBalance.toString()}, tx cost: ${gasLimit * parseInt(gasPrice)}`);
        }
        return transactionHashes;
    }
    async _sendWorkersEthBalancesToOwner(currentBlock) {
        // sending workers' balance to owner (currently one worker, todo: extend to multiple)
        const transactionHashes = [];
        const gasPrice = await this.contractInteractor.getGasPrice();
        const gasLimit = mintxgascost;
        const txCost = web3_utils_1.toBN(gasLimit * parseInt(gasPrice));
        const workerBalance = web3_utils_1.toBN(await this.contractInteractor.getBalance(this.workerAddress));
        if (workerBalance.gte(txCost)) {
            loglevel_1.default.info(`Sending workers' RBTC balance ${workerBalance.toString()} to owner`);
            const details = {
                signer: this.workerAddress,
                serverAction: StoredTransaction_1.ServerAction.VALUE_TRANSFER,
                destination: this.ownerAddress,
                gasLimit,
                gasPrice,
                value: web3_utils_1.toHex(workerBalance.sub(txCost)),
                creationBlockNumber: currentBlock
            };
            const { transactionHash } = await this.transactionManager.sendTransaction(details);
            transactionHashes.push(transactionHash);
        }
        else {
            loglevel_1.default.info(`balance too low: ${workerBalance.toString()}, tx cost: ${gasLimit * parseInt(gasPrice)}`);
        }
        return transactionHashes;
    }
    async _queryLatestWorkerAddedEvent() {
        const workersAddedEvents = await this.contractInteractor.getPastEventsForHub([rif_relay_common_1.address2topic(this.managerAddress)], {
            fromBlock: 1
        }, [rif_relay_common_1.RelayWorkersAdded]);
        return rif_relay_common_1.getLatestEventData(workersAddedEvents);
    }
    _isWorkerValid() {
        // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
        return (this.lastWorkerAddedTransaction != null &&
            this.lastWorkerAddedTransaction.returnValues.newRelayWorkers
                .map((a) => a.toLowerCase())
                .includes(this.workerAddress.toLowerCase()));
    }
    async isRegistered() {
        const isRegistrationCorrect = this._isRegistrationCorrect();
        return (this.stakeRequired.isSatisfied &&
            this.isStakeLocked &&
            isRegistrationCorrect);
    }
    printNotRegisteredMessage() {
        var _a;
        if (this._isRegistrationCorrect()) {
            return;
        }
        const message = `\nNot registered yet. Prerequisites:
${this.balanceRequired.description}
${this.stakeRequired.description}
Stake locked   | ${rif_relay_common_1.boolString(this.isStakeLocked)}
Manager        | ${this.managerAddress}
Worker         | ${this.workerAddress}
Owner          | ${(_a = this.ownerAddress) !== null && _a !== void 0 ? _a : chalk_1.default.red('k256')}
`;
        loglevel_1.default.info(message);
    }
    printEvents(decodedEvents, options) {
        var _a;
        if (decodedEvents.length === 0) {
            return;
        }
        loglevel_1.default.info(`Handling ${decodedEvents.length} events emitted since block: ${(_a = options.fromBlock) === null || _a === void 0 ? void 0 : _a.toString()}`);
        for (const decodedEvent of decodedEvents) {
            loglevel_1.default.info(`
Name      | ${decodedEvent.event.padEnd(25)}
Block     | ${decodedEvent.blockNumber}
TxHash    | ${decodedEvent.transactionHash}
`);
        }
    }
}
exports.RegistrationManager = RegistrationManager;
//# sourceMappingURL=RegistrationManager.js.map