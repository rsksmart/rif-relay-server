"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TxStoreManager = exports.TXSTORE_FILENAME = void 0;
const nedb_async_1 = __importDefault(require("nedb-async"));
const loglevel_1 = __importDefault(require("loglevel"));
const ow_1 = __importDefault(require("ow"));
const rif_relay_common_1 = require("@rsksmart/rif-relay-common");
exports.TXSTORE_FILENAME = 'txstore.db';
class TxStoreManager {
    constructor({ workdir = '/tmp/test/', inMemory = false }) {
        this.txstore = new nedb_async_1.default({
            filename: inMemory ? undefined : `${workdir}/${exports.TXSTORE_FILENAME}`,
            autoload: true,
            timestampData: true
        });
        this.txstore.asyncEnsureIndex({ fieldName: 'txId', unique: true });
        this.txstore.asyncEnsureIndex({
            fieldName: 'nonceSigner',
            unique: true
        });
        loglevel_1.default.info('Server database location:', inMemory ? 'memory' : `${workdir}/${exports.TXSTORE_FILENAME}`);
    }
    async putTx(tx, updateExisting = false) {
        // eslint-disable-next-line
        if (!tx || !tx.txId || !tx.attempts || tx.nonce === undefined) {
            throw new Error('Invalid tx:' + JSON.stringify(tx));
        }
        const nonceSigner = {
            nonce: tx.nonce,
            signer: tx.from.toLowerCase()
        };
        const tx1 = Object.assign(Object.assign({}, tx), { txId: tx.txId.toLowerCase(), nonceSigner });
        const existing = await this.txstore.asyncFindOne({
            nonceSigner: tx1.nonceSigner
        });
        // eslint-disable-next-line
        if (existing && updateExisting) {
            await this.txstore.asyncUpdate({ txId: existing.txId }, { $set: tx1 });
        }
        else {
            await this.txstore.asyncInsert(tx1);
        }
    }
    /**
     * Only for testing
     */
    async getTxByNonce(signer, nonce) {
        ow_1.default(nonce, ow_1.default.any(ow_1.default.number, ow_1.default.string));
        ow_1.default(signer, ow_1.default.string);
        return await this.txstore.asyncFindOne({
            nonceSigner: {
                signer: signer.toLowerCase(),
                nonce
            }
        });
    }
    /**
     * Only for testing
     */
    async getTxById(txId) {
        ow_1.default(txId, ow_1.default.string);
        return await this.txstore.asyncFindOne({ txId: txId.toLowerCase() });
    }
    async getTxsUntilNonce(signer, nonce) {
        return await this.txstore.asyncFind({
            $and: [
                { 'nonceSigner.nonce': { $lte: nonce } },
                { 'nonceSigner.signer': signer.toLowerCase() }
            ]
        });
    }
    async removeTxsUntilNonce(signer, nonce) {
        ow_1.default(nonce, ow_1.default.number);
        ow_1.default(signer, ow_1.default.string);
        return await this.txstore.asyncRemove({
            $and: [
                { 'nonceSigner.nonce': { $lte: nonce } },
                { 'nonceSigner.signer': signer.toLowerCase() }
            ]
        }, { multi: true });
    }
    async clearAll() {
        await this.txstore.asyncRemove({}, { multi: true });
    }
    async getAllBySigner(signer) {
        return (await this.txstore.asyncFind({
            'nonceSigner.signer': signer.toLowerCase()
        })).sort(function (tx1, tx2) {
            return tx1.nonce - tx2.nonce;
        });
    }
    async getAll() {
        return (await this.txstore.asyncFind({})).sort(function (tx1, tx2) {
            return tx1.nonce - tx2.nonce;
        });
    }
    async isActionPending(serverAction, destination = undefined) {
        const allTransactions = await this.getAll();
        return (allTransactions.find((it) => it.minedBlockNumber == null &&
            it.serverAction === serverAction &&
            (destination == null || rif_relay_common_1.isSameAddress(it.to, destination))) != null);
    }
}
exports.TxStoreManager = TxStoreManager;
//# sourceMappingURL=TxStoreManager.js.map