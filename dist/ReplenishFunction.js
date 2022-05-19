"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.replenishStrategy = void 0;
const web3_utils_1 = require("web3-utils");
const rif_relay_common_1 = require("@rsksmart/rif-relay-common");
const StoredTransaction_1 = require("./StoredTransaction");
const loglevel_1 = __importDefault(require("loglevel"));
async function replenishStrategy(relayServer, workerIndex, currentBlock) {
    let transactionHashes = [];
    if (relayServer.isCustomReplenish()) {
        // If custom replenish is settled, here should be a call to a custom function for replenish workers strategy.
        // Delete the next error if a custom replenish fuction is implemented.
        throw new Error('No custom replenish function found, to remove this error please add the custom replenish implementation here deleting this line.');
    }
    else {
        transactionHashes = await defaultReplenishFunction(relayServer, workerIndex, currentBlock);
    }
    return transactionHashes;
}
exports.replenishStrategy = replenishStrategy;
async function defaultReplenishFunction(relayServer, workerIndex, currentBlock) {
    const transactionHashes = [];
    let managerEthBalance = await relayServer.getManagerBalance();
    relayServer.workerBalanceRequired.currentValue =
        await relayServer.getWorkerBalance(workerIndex);
    if (managerEthBalance.gte(web3_utils_1.toBN(relayServer.config.managerTargetBalance.toString())) &&
        relayServer.workerBalanceRequired.isSatisfied) {
        // all filled, nothing to do
        return transactionHashes;
    }
    managerEthBalance = await relayServer.getManagerBalance();
    const mustReplenishWorker = !relayServer.workerBalanceRequired.isSatisfied;
    const isReplenishPendingForWorker = await relayServer.txStoreManager.isActionPending(StoredTransaction_1.ServerAction.VALUE_TRANSFER, relayServer.workerAddress);
    if (mustReplenishWorker && !isReplenishPendingForWorker) {
        const refill = web3_utils_1.toBN(relayServer.config.workerTargetBalance.toString()).sub(relayServer.workerBalanceRequired.currentValue);
        loglevel_1.default.info(`== replenishServer: mgr balance=${managerEthBalance.toString()}
        \n${relayServer.workerBalanceRequired.description}\n refill=${refill.toString()}`);
        if (refill.lt(managerEthBalance.sub(web3_utils_1.toBN(relayServer.config.managerMinBalance)))) {
            loglevel_1.default.info('Replenishing worker balance by manager rbtc balance');
            const details = {
                signer: relayServer.managerAddress,
                serverAction: StoredTransaction_1.ServerAction.VALUE_TRANSFER,
                destination: relayServer.workerAddress,
                value: web3_utils_1.toHex(refill),
                creationBlockNumber: currentBlock,
                gasLimit: rif_relay_common_1.defaultEnvironment.mintxgascost
            };
            const { transactionHash } = await relayServer.transactionManager.sendTransaction(details);
            transactionHashes.push(transactionHash);
        }
        else {
            const message = `== replenishServer: can't replenish: mgr balance too low ${managerEthBalance.toString()} refill=${refill.toString()}`;
            relayServer.emit('fundingNeeded', message);
            loglevel_1.default.info(message);
        }
    }
    return transactionHashes;
}
//# sourceMappingURL=ReplenishFunction.js.map