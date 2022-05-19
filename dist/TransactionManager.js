"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionManager = void 0;
// @ts-ignore
const ethval_1 = __importDefault(require("ethval"));
const chalk_1 = __importDefault(require("chalk"));
const loglevel_1 = __importDefault(require("loglevel"));
const async_mutex_1 = require("async-mutex");
const ethereumjs_tx_1 = require("ethereumjs-tx");
const StoredTransaction_1 = require("./StoredTransaction");
class TransactionManager {
    constructor(dependencies, config) {
        this.nonceMutex = new async_mutex_1.Mutex();
        this.nonces = {};
        this.contractInteractor = dependencies.contractInteractor;
        this.txStoreManager = dependencies.txStoreManager;
        this.workersKeyManager = dependencies.workersKeyManager;
        this.managerKeyManager = dependencies.managerKeyManager;
        this.config = config;
        this._initNonces();
    }
    _initNonces() {
        // todo: initialize nonces for all signers (currently one manager, one worker)
        this.nonces[this.managerKeyManager.getAddress(0)] = 0;
        this.nonces[this.workersKeyManager.getAddress(0)] = 0;
    }
    async _init() {
        this.rawTxOptions = this.contractInteractor.getRawTxOptions();
        if (this.rawTxOptions == null) {
            throw new Error('_init failed for TransactionManager, was ContractInteractor properly initialized?');
        }
    }
    printBoostedTransactionLog(txHash, creationBlockNumber, gasPrice, isMaxGasPriceReached) {
        const gasPriceHumanReadableOld = new ethval_1.default(gasPrice)
            .toGwei()
            .toFixed(4);
        loglevel_1.default.info(`Boosting stale transaction:
hash         | ${txHash}
gasPrice     | ${gasPrice} (${gasPriceHumanReadableOld} gwei) ${isMaxGasPriceReached ? chalk_1.default.red('k256') : ''}
created at   | block #${creationBlockNumber}
`);
    }
    printSendTransactionLog(transaction, from) {
        const valueString = transaction.value.length === 0
            ? '0'
            : parseInt('0x' + transaction.value.toString('hex')).toString();
        const nonceString = transaction.nonce.length === 0
            ? '0'
            : parseInt('0x' + transaction.nonce.toString('hex'));
        const gasPriceString = parseInt('0x' + transaction.gasPrice.toString('hex'));
        const valueHumanReadable = new ethval_1.default(valueString)
            .toEth()
            .toFixed(4);
        const gasPriceHumanReadable = new ethval_1.default(gasPriceString)
            .toGwei()
            .toFixed(4);
        loglevel_1.default.info(`Broadcasting transaction:
hash         | 0x${transaction.hash().toString('hex')}
from         | ${from}
to           | 0x${transaction.to.toString('hex')}
value        | ${valueString} (${valueHumanReadable} RBTC)
nonce        | ${nonceString}
gasPrice     | ${gasPriceString} (${gasPriceHumanReadable} gwei)
gasLimit     | ${parseInt('0x' + transaction.gasLimit.toString('hex'))}
data         | 0x${transaction.data.toString('hex')}
`);
    }
    async attemptEstimateGas(methodName, method, from) {
        try {
            const estimateGas = await method.estimateGas({ from });
            return Math.round(parseInt(estimateGas) * this.config.estimateGasFactor);
        }
        catch (e) {
            if (e instanceof Error) {
                loglevel_1.default.error(`Failed to estimate gas for method ${methodName}\n. Using default ${this.config.defaultGasLimit}`, e.message);
            }
            else {
                loglevel_1.default.error(e);
            }
        }
        return this.config.defaultGasLimit;
    }
    async sendTransaction({ signer, method, destination, value = '0x', gasLimit, gasPrice, creationBlockNumber, serverAction }) {
        var _a;
        const encodedCall = (_a = method === null || method === void 0 ? void 0 : method.encodeABI()) !== null && _a !== void 0 ? _a : '0x';
        const _gasPrice = parseInt(gasPrice !== null && gasPrice !== void 0 ? gasPrice : (await this.contractInteractor.getGasPrice()));
        const releaseMutex = await this.nonceMutex.acquire();
        let signedTx;
        let storedTx;
        try {
            const nonce = await this.pollNonce(signer);
            const txToSign = new ethereumjs_tx_1.Transaction({
                to: destination,
                value: value,
                gasLimit,
                gasPrice: _gasPrice,
                data: Buffer.from(encodedCall.slice(2), 'hex'),
                nonce
            }, this.rawTxOptions);
            // TODO omg! do not do this!
            const keyManager = this.managerKeyManager.isSigner(signer)
                ? this.managerKeyManager
                : this.workersKeyManager;
            signedTx = keyManager.signTransaction(signer, txToSign);
            const metadata = {
                from: signer,
                attempts: 1,
                serverAction,
                creationBlockNumber
            };
            storedTx = StoredTransaction_1.createStoredTransaction(txToSign, metadata);
            this.nonces[signer]++;
            await this.txStoreManager.putTx(storedTx, false);
            this.printSendTransactionLog(txToSign, signer);
        }
        finally {
            releaseMutex();
        }
        const transactionHash = await this.contractInteractor.broadcastTransaction(signedTx);
        if (transactionHash.toLowerCase() !== storedTx.txId.toLowerCase()) {
            throw new Error(`txhash mismatch: from receipt: ${transactionHash} from txstore:${storedTx.txId}`);
        }
        return {
            transactionHash,
            signedTx
        };
    }
    async updateTransactionWithMinedBlock(tx, minedBlockNumber) {
        const storedTx = Object.assign({}, tx, {
            minedBlockNumber
        });
        await this.txStoreManager.putTx(storedTx, true);
    }
    async updateTransactionWithAttempt(txToSign, tx, currentBlock) {
        const metadata = {
            attempts: tx.attempts + 1,
            boostBlockNumber: currentBlock,
            from: tx.from,
            serverAction: tx.serverAction,
            creationBlockNumber: tx.creationBlockNumber,
            minedBlockNumber: tx.minedBlockNumber
        };
        const storedTx = StoredTransaction_1.createStoredTransaction(txToSign, metadata);
        await this.txStoreManager.putTx(storedTx, true);
        return storedTx;
    }
    async resendTransaction(tx, currentBlock, newGasPrice, isMaxGasPriceReached) {
        // Resend transaction with exactly the same values except for gas price
        const txToSign = new ethereumjs_tx_1.Transaction({
            to: tx.to,
            gasLimit: tx.gas,
            gasPrice: newGasPrice,
            data: tx.data,
            nonce: tx.nonce
        }, this.rawTxOptions);
        const keyManager = this.managerKeyManager.isSigner(tx.from)
            ? this.managerKeyManager
            : this.workersKeyManager;
        const signedTx = keyManager.signTransaction(tx.from, txToSign);
        const storedTx = await this.updateTransactionWithAttempt(txToSign, tx, currentBlock);
        this.printBoostedTransactionLog(tx.txId, tx.creationBlockNumber, tx.gasPrice, isMaxGasPriceReached);
        this.printSendTransactionLog(txToSign, tx.from);
        const currentNonce = await this.contractInteractor.getTransactionCount(tx.from);
        loglevel_1.default.debug(`Current account nonce for ${tx.from} is ${currentNonce}`);
        const transactionHash = await this.contractInteractor.broadcastTransaction(signedTx);
        if (transactionHash.toLowerCase() !== storedTx.txId.toLowerCase()) {
            throw new Error(`txhash mismatch: from receipt: ${transactionHash} from txstore:${storedTx.txId}`);
        }
        return {
            transactionHash,
            signedTx
        };
    }
    _resolveNewGasPrice(oldGasPrice) {
        let isMaxGasPriceReached = false;
        let newGasPrice = oldGasPrice * this.config.retryGasPriceFactor;
        // TODO: use BN for RBTC values
        // Sanity check to ensure we are not burning all our balance in gas fees
        if (newGasPrice > parseInt(this.config.maxGasPrice)) {
            isMaxGasPriceReached = true;
            newGasPrice = parseInt(this.config.maxGasPrice);
        }
        return { newGasPrice, isMaxGasPriceReached };
    }
    async pollNonce(signer) {
        const nonce = await this.contractInteractor.getTransactionCount(signer, 'pending');
        if (nonce > this.nonces[signer]) {
            loglevel_1.default.warn('NONCE FIX for signer=', signer, ': nonce=', nonce, this.nonces[signer]);
            this.nonces[signer] = nonce;
        }
        return this.nonces[signer];
    }
    async removeConfirmedTransactions(blockNumber) {
        // Load unconfirmed transactions from store, and bail if there are none
        const sortedTxs = await this.txStoreManager.getAll();
        if (sortedTxs.length === 0) {
            return;
        }
        loglevel_1.default.debug(`Total of ${sortedTxs.length} transactions are not confirmed yet, checking...`);
        // Get nonce at confirmationsNeeded blocks ago
        for (const transaction of sortedTxs) {
            const shouldRecheck = transaction.minedBlockNumber == null ||
                blockNumber - transaction.minedBlockNumber >=
                    this.config.confirmationsNeeded;
            if (shouldRecheck) {
                const receipt = await this.contractInteractor.getTransaction(transaction.txId);
                if (receipt == null) {
                    loglevel_1.default.warn(`warning: failed to fetch receipt for tx ${transaction.txId}`);
                    continue;
                }
                if (receipt.blockNumber == null) {
                    loglevel_1.default.warn(`warning: null block number in receipt for ${transaction.txId}`);
                    continue;
                }
                const confirmations = blockNumber - receipt.blockNumber;
                if (receipt.blockNumber !== transaction.minedBlockNumber) {
                    if (transaction.minedBlockNumber != null) {
                        loglevel_1.default.warn(`transaction ${transaction.txId} was moved between blocks`);
                    }
                    if (confirmations < this.config.confirmationsNeeded) {
                        loglevel_1.default.debug(`Tx ${transaction.txId} was mined but only has ${confirmations} confirmations`);
                        await this.updateTransactionWithMinedBlock(transaction, receipt.blockNumber);
                        continue;
                    }
                }
                // Clear out all confirmed transactions (ie txs with nonce less than the account nonce at confirmationsNeeded blocks ago)
                loglevel_1.default.debug(`removing tx number ${receipt.nonce} sent by ${receipt.from} with ${confirmations} confirmations`);
                await this.txStoreManager.removeTxsUntilNonce(receipt.from, receipt.nonce);
            }
        }
    }
    /**
     * This methods uses the oldest pending transaction for reference. If it was not mined in a reasonable time,
     * it is boosted all consequent transactions with gas price lower then that are boosted as well.
     */
    async boostUnderpricedPendingTransactionsForSigner(signer, currentBlockHeight) {
        var _a;
        const boostedTransactions = new Map();
        // Load unconfirmed transactions from store again
        const sortedTxs = await this.txStoreManager.getAllBySigner(signer);
        if (sortedTxs.length === 0) {
            return boostedTransactions;
        }
        // Check if the tx was mined by comparing its nonce against the latest one
        const nonce = await this.contractInteractor.getTransactionCount(signer);
        const oldestPendingTx = sortedTxs[0];
        if (oldestPendingTx.nonce < nonce) {
            loglevel_1.default.debug(`${signer} : transaction is mined, awaiting confirmations. Account nonce: ${nonce}, oldest transaction: nonce: ${oldestPendingTx.nonce} txId: ${oldestPendingTx.txId}`);
            return boostedTransactions;
        }
        const lastSentAtBlockHeight = (_a = oldestPendingTx.boostBlockNumber) !== null && _a !== void 0 ? _a : oldestPendingTx.creationBlockNumber;
        // If the tx is still pending, check how long ago we sent it, and resend it if needed
        if (currentBlockHeight - lastSentAtBlockHeight <
            this.config.pendingTransactionTimeoutBlocks) {
            loglevel_1.default.debug(`${signer} : awaiting transaction with ID: ${oldestPendingTx.txId} to be mined. creationBlockNumber: ${oldestPendingTx.creationBlockNumber} nonce: ${nonce}`);
            return boostedTransactions;
        }
        // Calculate new gas price as a % increase over the previous one
        const { newGasPrice, isMaxGasPriceReached } = this._resolveNewGasPrice(oldestPendingTx.gasPrice);
        const underpricedTransactions = sortedTxs.filter((it) => it.gasPrice < newGasPrice);
        for (const transaction of underpricedTransactions) {
            const boostedTransactionDetails = await this.resendTransaction(transaction, currentBlockHeight, newGasPrice, isMaxGasPriceReached);
            boostedTransactions.set(transaction.txId, boostedTransactionDetails);
            loglevel_1.default.debug(`Replaced transaction: nonce: ${transaction.nonce} sender: ${signer} | ${transaction.txId} => ${boostedTransactionDetails.transactionHash}`);
            if (transaction.attempts > 2) {
                loglevel_1.default.debug(`resend ${signer}: Sent tx ${transaction.attempts} times already`);
            }
        }
        return boostedTransactions;
    }
}
exports.TransactionManager = TransactionManager;
//# sourceMappingURL=TransactionManager.js.map