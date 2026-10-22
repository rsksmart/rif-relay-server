import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon, { SinonStub, SinonStubbedInstance } from 'sinon';
import sinonChai from 'sinon-chai';
import { BigNumber, providers, utils } from 'ethers';
import {
  KeyManager,
  ServerAction,
  StoredTransaction,
  TransactionManager,
  TxStoreManager,
  isRefusedByNode,
} from '../../src';
import * as serverUtils from '../../src/Utils';

use(sinonChai);
use(chaiAsPromised);

const logger = new utils.Logger('test');

describe('TransactionManager tests', function () {
  const MANAGER_ADDRESS = '0x0000000000000000000000000000000000000001';
  const WORKER_ADDRESS = '0x74105590d404df3f384a099c2e55135281ca6b40';
  const DESTINATION = '0x0000000000000000000000000000000000000002';
  const TX_HASH =
    '0x1111111111111111111111111111111111111111111111111111111111111111';
  const OLD_TX_HASH =
    '0x2222222222222222222222222222222222222222222222222222222222222222';
  const NONCE = 5;
  // eth_gasPrice of a Rootstock testnet node
  const NODE_GAS_PRICE = '6215177';

  // How ethers reports a JSON-RPC error answered by the node
  function nodeRefusal(message: string) {
    const rpcError = Object.assign(new Error(message), { code: -32010 });

    return logger.makeError(
      'processing response error',
      utils.Logger.errors.SERVER_ERROR,
      { error: rpcError }
    );
  }

  // How ethers reports a request the node never answered
  function lostResponse() {
    return logger.makeError('timeout', utils.Logger.errors.TIMEOUT, {
      timeout: 120000,
    });
  }

  let transactionManager: TransactionManager;
  let txStoreManager: SinonStubbedInstance<TxStoreManager>;
  let workersKeyManager: SinonStubbedInstance<KeyManager>;
  let broadcast: SinonStub;
  let readProvider: {
    getGasPrice: SinonStub;
    getNetwork: SinonStub;
    getTransactionCount: SinonStub;
    getTransaction: SinonStub;
  };
  let writeProvider: {
    sendTransaction: SinonStub;
    getTransactionCount: SinonStub;
    getTransaction: SinonStub;
    getBalance: SinonStub;
  };

  beforeEach(function () {
    const managerKeyManager = sinon.createStubInstance(KeyManager);
    managerKeyManager.getAddress.returns(MANAGER_ADDRESS);
    managerKeyManager.isSigner.callsFake(
      (address) => address === MANAGER_ADDRESS
    );
    workersKeyManager = sinon.createStubInstance(KeyManager);
    workersKeyManager.getAddress.returns(WORKER_ADDRESS);
    workersKeyManager.isSigner.callsFake(
      (address) => address === WORKER_ADDRESS
    );
    workersKeyManager.signTransaction.resolves({
      txHash: TX_HASH,
      signedTx: '0xsigned',
    });
    txStoreManager = sinon.createStubInstance(TxStoreManager);

    readProvider = {
      getGasPrice: sinon.stub().resolves(BigNumber.from(NODE_GAS_PRICE)),
      getNetwork: sinon.stub().resolves({ chainId: 31, name: 'rsk' }),
      getTransactionCount: sinon.stub().resolves(NONCE),
      getTransaction: sinon.stub().resolves(null),
    };
    sinon
      .stub(serverUtils, 'getProvider')
      .returns(readProvider as unknown as providers.Provider);
    broadcast = sinon.stub();
    writeProvider = {
      sendTransaction: broadcast,
      getTransactionCount: sinon.stub().resolves(NONCE),
      getTransaction: sinon.stub().resolves(null),
      // enough for any boost, so planBoost never lowers a value
      getBalance: sinon.stub().resolves(BigNumber.from(10).pow(18)),
    };
    sinon
      .stub(serverUtils, 'getWriteProvider')
      .returns(writeProvider as unknown as providers.Provider);

    transactionManager = new TransactionManager({
      managerKeyManager,
      workersKeyManager,
      txStoreManager,
    });
  });

  afterEach(function () {
    sinon.restore();
  });

  function sendRelayTransaction(gasPrice = BigNumber.from(NODE_GAS_PRICE)) {
    return transactionManager.sendTransaction({
      signer: WORKER_ADDRESS,
      serverAction: ServerAction.RELAY_CALL,
      destination: DESTINATION,
      gasLimit: BigNumber.from(100000),
      gasPrice,
      creationBlockNumber: 1,
    });
  }

  function createStoredTx(gasPrice: BigNumber): StoredTransaction {
    return {
      txId: OLD_TX_HASH,
      from: WORKER_ADDRESS,
      attempts: 1,
      serverAction: ServerAction.RELAY_CALL,
      creationBlockNumber: 1,
      to: DESTINATION,
      gasLimit: BigNumber.from(100000),
      gasPrice,
      data: '0x',
      nonce: NONCE,
    };
  }

  describe('Function sendTransaction()', function () {
    it('should take the next nonce and keep the transaction when the node accepts it', async function () {
      broadcast.resolves({ hash: TX_HASH });

      await expect(sendRelayTransaction()).to.be.fulfilled;

      expect(transactionManager.nonces[WORKER_ADDRESS]).to.equal(NONCE + 1);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.putTx).to.have.been.calledOnceWith(
        sinon.match({ txId: TX_HASH, nonce: NONCE }),
        false
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.removeTx).not.to.have.been.called;
    });

    it('should give the nonce back and forget the transaction when the node refuses it', async function () {
      broadcast.rejects(nodeRefusal('gas price above cap'));

      await expect(sendRelayTransaction()).to.be.rejectedWith(
        'processing response error'
      );

      expect(transactionManager.nonces[WORKER_ADDRESS]).to.equal(NONCE);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.removeTx).to.have.been.calledOnceWith(
        sinon.match({ txId: TX_HASH, nonce: NONCE })
      );
    });

    it('should reuse the nonce of a refused transaction for the next one', async function () {
      broadcast.onFirstCall().rejects(nodeRefusal('gas price above cap'));
      broadcast.onSecondCall().resolves({ hash: TX_HASH });

      await expect(sendRelayTransaction()).to.be.rejected;
      await expect(sendRelayTransaction()).to.be.fulfilled;

      const [, firstTx] = workersKeyManager.signTransaction.firstCall.args;
      const [, secondTx] = workersKeyManager.signTransaction.secondCall.args;
      expect(firstTx.nonce).to.equal(NONCE);
      expect(secondTx.nonce).to.equal(NONCE);
      expect(transactionManager.nonces[WORKER_ADDRESS]).to.equal(NONCE + 1);
    });

    it('should keep the nonce and the transaction when the response to the broadcast is lost', async function () {
      // the node may have accepted the transaction before the response was lost
      broadcast.rejects(lostResponse());

      await expect(sendRelayTransaction()).to.be.rejectedWith('timeout');

      expect(transactionManager.nonces[WORKER_ADDRESS]).to.equal(NONCE + 1);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.putTx).to.have.been.calledOnceWith(
        sinon.match({ txId: TX_HASH, nonce: NONCE }),
        false
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.removeTx).not.to.have.been.called;
    });

    it('should not reuse the nonce of a transaction whose broadcast response was lost', async function () {
      broadcast.onFirstCall().rejects(lostResponse());
      broadcast.onSecondCall().resolves({ hash: TX_HASH });

      await expect(sendRelayTransaction()).to.be.rejected;
      await expect(sendRelayTransaction()).to.be.fulfilled;

      const [, secondTx] = workersKeyManager.signTransaction.secondCall.args;
      expect(secondTx.nonce).to.equal(NONCE + 1);
    });
  });

  describe('Function resendTransaction()', function () {
    it('should keep the transaction as last broadcast when the node refuses the boost', async function () {
      const storedTx = createStoredTx(BigNumber.from(100000000));
      broadcast.rejects(nodeRefusal('gas price above cap'));

      await expect(
        transactionManager.resendTransaction(
          storedTx,
          10,
          BigNumber.from(120000000),
          false
        )
      ).to.be.rejectedWith('processing response error');

      expect(txStoreManager.putTx.firstCall).to.have.been.calledWith(
        sinon.match({ txId: TX_HASH, attempts: 2 }),
        true
      );
      expect(txStoreManager.putTx.lastCall).to.have.been.calledWith(
        storedTx,
        true
      );
    });

    it('should keep the boosted transaction when the response to its broadcast is lost', async function () {
      // the node may have accepted the boost before the response was lost
      const storedTx = createStoredTx(BigNumber.from(100000000));
      broadcast.rejects(lostResponse());

      await expect(
        transactionManager.resendTransaction(
          storedTx,
          10,
          BigNumber.from(120000000),
          false
        )
      ).to.be.rejectedWith('timeout');

      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.putTx).to.have.been.calledOnceWith(
        sinon.match({ txId: TX_HASH, attempts: 2 }),
        true
      );
    });

    it('should track the boosted transaction when the node accepts it', async function () {
      const storedTx = createStoredTx(BigNumber.from(100000000));
      broadcast.resolves({ hash: TX_HASH });

      await expect(
        transactionManager.resendTransaction(
          storedTx,
          10,
          BigNumber.from(120000000),
          false
        )
      ).to.be.fulfilled;

      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.putTx).to.have.been.calledOnceWith(
        sinon.match({ txId: TX_HASH, attempts: 2, boostBlockNumber: 10 }),
        true
      );
      const [boostedTx] = txStoreManager.putTx.firstCall.args;
      expect(boostedTx.gasPrice?.toString()).to.equal('120000000');
    });

    it('should keep the attempt of a transaction sent again unchanged when the node refuses it', async function () {
      // sent again at its own price, it signs to the hash already stored; the
      // node doesn't have it, so the refusal is a real one
      const storedTx = {
        ...createStoredTx(BigNumber.from(100000000)),
        txId: TX_HASH,
      };
      broadcast.rejects(nodeRefusal('insufficient funds'));

      await expect(
        transactionManager.resendTransaction(
          storedTx,
          10,
          BigNumber.from(100000000),
          true
        )
      ).to.be.rejectedWith('processing response error');

      // the attempt stays, so the boost waits for the next timeout instead of
      // sending it on every block
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.putTx).to.have.been.calledOnceWith(
        sinon.match({ txId: TX_HASH, attempts: 2, boostBlockNumber: 10 }),
        true
      );
    });

    it('should take a transaction sent again unchanged that the node already has as sent', async function () {
      const storedTx = {
        ...createStoredTx(BigNumber.from(100000000)),
        txId: TX_HASH,
      };
      broadcast.rejects(nodeRefusal('transaction already in pool'));
      writeProvider.getTransaction
        .withArgs(TX_HASH)
        .resolves({ hash: TX_HASH });

      await expect(
        transactionManager.resendTransaction(
          storedTx,
          10,
          BigNumber.from(100000000),
          true
        )
      ).to.be.fulfilled;

      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.putTx).to.have.been.calledOnceWith(
        sinon.match({ txId: TX_HASH, attempts: 2, boostBlockNumber: 10 }),
        true
      );
    });

    it('should not take a transaction refused after a boost as sent although the node has the previous one', async function () {
      const storedTx = createStoredTx(BigNumber.from(100000000));
      broadcast.rejects(nodeRefusal('gas price above cap'));
      writeProvider.getTransaction.resolves({ hash: OLD_TX_HASH });

      await expect(
        transactionManager.resendTransaction(
          storedTx,
          10,
          BigNumber.from(120000000),
          false
        )
      ).to.be.rejectedWith('processing response error');

      expect(txStoreManager.putTx.lastCall).to.have.been.calledWith(
        storedTx,
        true
      );
    });
  });

  describe('Function removeConfirmedTransactions()', function () {
    const BLOCK_NUMBER = 100;

    beforeEach(function () {
      // a boost whose broadcast response was lost and that never reached the
      // node, while the transaction it replaces was mined
      txStoreManager.getAll.resolves([
        { ...createStoredTx(BigNumber.from(120000000)), txId: TX_HASH },
      ]);
      readProvider.getTransaction.resolves(null);
    });

    it('should forget a transaction whose nonce was confirmed under another hash', async function () {
      readProvider.getTransactionCount.resolves(NONCE + 1);

      await transactionManager.removeConfirmedTransactions(BLOCK_NUMBER);

      expect(readProvider.getTransactionCount).to.have.been.calledOnceWith(
        WORKER_ADDRESS,
        BLOCK_NUMBER - transactionManager.config.blockchain.confirmationsNeeded
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.removeTxsUntilNonce).to.have.been.calledOnceWith(
        WORKER_ADDRESS,
        NONCE
      );
    });

    it('should keep a transaction whose nonce is not confirmed yet', async function () {
      readProvider.getTransactionCount.resolves(NONCE);

      await transactionManager.removeConfirmedTransactions(BLOCK_NUMBER);

      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.removeTxsUntilNonce).not.to.have.been.called;
    });

    it('should forget a transaction with nonce 0 confirmed under another hash', async function () {
      txStoreManager.getAll.resolves([
        {
          ...createStoredTx(BigNumber.from(120000000)),
          txId: TX_HASH,
          nonce: 0,
        },
      ]);
      readProvider.getTransactionCount.resolves(1);

      await transactionManager.removeConfirmedTransactions(BLOCK_NUMBER);

      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.removeTxsUntilNonce).to.have.been.calledOnceWith(
        WORKER_ADDRESS,
        0
      );
    });

    it('should keep the transaction while the chain is shorter than the confirmations needed', async function () {
      const { confirmationsNeeded } = transactionManager.config.blockchain;

      await transactionManager.removeConfirmedTransactions(
        confirmationsNeeded - 1
      );

      expect(readProvider.getTransactionCount).not.to.have.been.called;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.removeTxsUntilNonce).not.to.have.been.called;
    });

    it('should keep the transaction when the confirmed nonce cannot be read', async function () {
      readProvider.getTransactionCount.rejects(lostResponse());

      await expect(
        transactionManager.removeConfirmedTransactions(BLOCK_NUMBER)
      ).to.be.rejectedWith('timeout');

      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.removeTxsUntilNonce).not.to.have.been.called;
    });
  });

  describe('Function isRefusedByNode()', function () {
    it('should tell a JSON-RPC error answered by the node', function () {
      expect(isRefusedByNode(nodeRefusal('gas price above cap'))).to.be.true;
    });

    it('should tell a JSON-RPC error that ethers classified', function () {
      const nonceExpired = logger.makeError(
        'nonce has already been used',
        utils.Logger.errors.NONCE_EXPIRED,
        { error: nodeRefusal('nonce too low') }
      );

      expect(isRefusedByNode(nonceExpired)).to.be.true;
    });

    it('should not take a timeout for a refusal', function () {
      expect(isRefusedByNode(lostResponse())).to.be.false;
    });

    it('should not take a lost connection for a refusal', function () {
      const missingResponse = logger.makeError(
        'missing response',
        utils.Logger.errors.SERVER_ERROR,
        { serverError: new Error('socket hang up') }
      );

      expect(isRefusedByNode(missingResponse)).to.be.false;
    });
  });

  describe('Function _resolveNewGasPrice()', function () {
    it('should raise the gasPrice by the retry factor', function () {
      const { newGasPrice, isMaxGasPriceReached } =
        transactionManager._resolveNewGasPrice(
          BigNumber.from(10000000),
          BigNumber.from(NODE_GAS_PRICE)
        );

      expect(newGasPrice.toString()).to.equal('12000000');
      expect(isMaxGasPriceReached).to.be.false;
    });

    it('should not raise the gasPrice above what the node accepts', function () {
      // 20 times the node gasPrice, below maxGasPrice
      const nodeMaxGasPrice = BigNumber.from(NODE_GAS_PRICE).mul(20);

      const { newGasPrice, isMaxGasPriceReached } =
        transactionManager._resolveNewGasPrice(
          nodeMaxGasPrice.sub(1),
          BigNumber.from(NODE_GAS_PRICE)
        );

      expect(newGasPrice.toString()).to.equal(nodeMaxGasPrice.toString());
      expect(isMaxGasPriceReached).to.be.true;
    });

    it('should not raise the gasPrice above maxGasPrice', function () {
      transactionManager.config = {
        ...transactionManager.config,
        blockchain: {
          ...transactionManager.config.blockchain,
          maxGasPrice: 100000000,
        },
      };

      const { newGasPrice, isMaxGasPriceReached } =
        transactionManager._resolveNewGasPrice(
          BigNumber.from(99999999),
          BigNumber.from(NODE_GAS_PRICE)
        );

      expect(newGasPrice.toString()).to.equal('100000000');
      expect(isMaxGasPriceReached).to.be.true;
    });
  });

  describe('Function boostUnderpricedPendingTransactionsForSigner()', function () {
    it('should boost a stale transaction up to what the node accepts at that moment', async function () {
      const { pendingTransactionTimeoutBlocks } =
        transactionManager.config.blockchain;
      const nodeMaxGasPrice = BigNumber.from(NODE_GAS_PRICE).mul(20);
      txStoreManager.getAllBySigner.resolves([
        createStoredTx(nodeMaxGasPrice.sub(1)),
      ]);
      broadcast.resolves({ hash: TX_HASH });

      const boosted =
        await transactionManager.boostUnderpricedPendingTransactionsForSigner(
          WORKER_ADDRESS,
          1 + pendingTransactionTimeoutBlocks
        );

      expect(boosted.size).to.equal(1);
      const [, boostedTx] = workersKeyManager.signTransaction.firstCall.args;
      expect(boostedTx.gasPrice?.toString()).to.equal(
        nodeMaxGasPrice.toString()
      );
    });

    it('should send again a transaction at the maximum whose first broadcast was lost', async function () {
      const { pendingTransactionTimeoutBlocks } =
        transactionManager.config.blockchain;
      const nodeMaxGasPrice = BigNumber.from(NODE_GAS_PRICE).mul(20);
      // the broadcast times out before reaching the node, so the transaction
      // and its nonce stay taken although the node never saw it
      broadcast.onFirstCall().rejects(lostResponse());
      broadcast.onSecondCall().resolves({ hash: TX_HASH });
      await expect(sendRelayTransaction(nodeMaxGasPrice)).to.be.rejectedWith(
        'timeout'
      );
      const [storedTx] = txStoreManager.putTx.firstCall.args;
      txStoreManager.getAllBySigner.resolves([storedTx]);

      const boosted =
        await transactionManager.boostUnderpricedPendingTransactionsForSigner(
          WORKER_ADDRESS,
          1 + pendingTransactionTimeoutBlocks
        );

      expect(boosted.size).to.equal(1);
      expect(broadcast).to.have.been.calledTwice;
      const [, resentTx] = workersKeyManager.signTransaction.secondCall.args;
      expect(resentTx.nonce).to.equal(NONCE);
      expect(resentTx.gasPrice?.toString()).to.equal(
        nodeMaxGasPrice.toString()
      );
    });

    it('should send again a stale transaction priced above the maximum at its own price', async function () {
      const { pendingTransactionTimeoutBlocks } =
        transactionManager.config.blockchain;
      // priced when the node gasPrice was higher; a replacement cannot lower it
      const storedGasPrice = BigNumber.from(NODE_GAS_PRICE).mul(30);
      txStoreManager.getAllBySigner.resolves([createStoredTx(storedGasPrice)]);
      broadcast.resolves({ hash: TX_HASH });

      await transactionManager.boostUnderpricedPendingTransactionsForSigner(
        WORKER_ADDRESS,
        1 + pendingTransactionTimeoutBlocks
      );

      const [, resentTx] = workersKeyManager.signTransaction.firstCall.args;
      expect(resentTx.gasPrice?.toString()).to.equal(storedGasPrice.toString());
    });

    it('should boost only once the oldest transaction has waited the pending timeout', async function () {
      const { pendingTransactionTimeoutBlocks } =
        transactionManager.config.blockchain;
      txStoreManager.getAllBySigner.resolves([
        createStoredTx(BigNumber.from(NODE_GAS_PRICE)),
      ]);
      broadcast.resolves({ hash: TX_HASH });

      const early =
        await transactionManager.boostUnderpricedPendingTransactionsForSigner(
          WORKER_ADDRESS,
          pendingTransactionTimeoutBlocks
        );
      expect(early.size).to.equal(0);
      expect(broadcast).not.to.have.been.called;

      const onTime =
        await transactionManager.boostUnderpricedPendingTransactionsForSigner(
          WORKER_ADDRESS,
          1 + pendingTransactionTimeoutBlocks
        );
      expect(onTime.size).to.equal(1);
    });

    it('should go on boosting when the node already has the oldest transaction sent again unchanged', async function () {
      const { pendingTransactionTimeoutBlocks } =
        transactionManager.config.blockchain;
      const nodeMaxGasPrice = BigNumber.from(NODE_GAS_PRICE).mul(20);
      const BOOST_HASH =
        '0x3333333333333333333333333333333333333333333333333333333333333333';
      // the oldest is at a price that can't be raised and still in the pool
      const oldestTx = {
        ...createStoredTx(BigNumber.from(NODE_GAS_PRICE).mul(30)),
        txId: TX_HASH,
      };
      const cheaperTx = {
        ...createStoredTx(BigNumber.from(NODE_GAS_PRICE)),
        nonce: NONCE + 1,
      };
      txStoreManager.getAllBySigner.resolves([oldestTx, cheaperTx]);
      workersKeyManager.signTransaction
        .onSecondCall()
        .resolves({ txHash: BOOST_HASH, signedTx: '0xboosted' });
      broadcast
        .onFirstCall()
        .rejects(nodeRefusal('transaction already in pool'));
      broadcast.onSecondCall().resolves({ hash: BOOST_HASH });
      writeProvider.getTransaction
        .withArgs(TX_HASH)
        .resolves({ hash: TX_HASH });

      const boosted =
        await transactionManager.boostUnderpricedPendingTransactionsForSigner(
          WORKER_ADDRESS,
          1 + pendingTransactionTimeoutBlocks
        );

      expect(boosted.size).to.equal(2);
      const [, boostedTx] = workersKeyManager.signTransaction.secondCall.args;
      expect(boostedTx.nonce).to.equal(NONCE + 1);
      expect(boostedTx.gasPrice?.toString()).to.equal(
        nodeMaxGasPrice.toString()
      );
    });

    it('should wait for a broadcast in flight before reading the transactions to boost', async function () {
      const { pendingTransactionTimeoutBlocks } =
        transactionManager.config.blockchain;
      // the first broadcast hangs until the test refuses it
      let refuseBroadcast: (error: Error) => void = () => undefined;
      broadcast.onFirstCall().returns(
        new Promise((_resolve, reject) => {
          refuseBroadcast = reject;
        })
      );
      txStoreManager.getAllBySigner.resolves([]);
      const flush = () => new Promise((resolve) => setImmediate(resolve));

      const sending = sendRelayTransaction();
      while (!broadcast.called) {
        await flush();
      }
      const boosting =
        transactionManager.boostUnderpricedPendingTransactionsForSigner(
          WORKER_ADDRESS,
          1 + pendingTransactionTimeoutBlocks
        );
      await flush();

      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.getAllBySigner).not.to.have.been.called;

      refuseBroadcast(nodeRefusal('gas price above cap'));
      await expect(sending).to.be.rejected;
      await expect(boosting).to.be.fulfilled;

      // the boost reads the store only after the refusal gave the nonce back
      expect(
        txStoreManager.removeTx.firstCall.calledBefore(
          txStoreManager.getAllBySigner.firstCall
        )
      ).to.be.true;
      expect(transactionManager.nonces[WORKER_ADDRESS]).to.equal(NONCE);
    });
  });
});
