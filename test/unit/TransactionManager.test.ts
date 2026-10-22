import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon, { SinonStub, SinonStubbedInstance } from 'sinon';
import sinonChai from 'sinon-chai';
import { BigNumber, providers } from 'ethers';
import {
  KeyManager,
  ServerAction,
  StoredTransaction,
  TransactionManager,
  TxStoreManager,
} from '../../src';
import * as serverUtils from '../../src/Utils';

use(sinonChai);
use(chaiAsPromised);

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

  let transactionManager: TransactionManager;
  let txStoreManager: SinonStubbedInstance<TxStoreManager>;
  let workersKeyManager: SinonStubbedInstance<KeyManager>;
  let broadcast: SinonStub;

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

    sinon.stub(serverUtils, 'getProvider').returns({
      getGasPrice: sinon.stub().resolves(BigNumber.from(NODE_GAS_PRICE)),
      getNetwork: sinon.stub().resolves({ chainId: 31, name: 'rsk' }),
      getTransactionCount: sinon.stub().resolves(NONCE),
    } as unknown as providers.Provider);
    broadcast = sinon.stub();
    sinon.stub(serverUtils, 'getWriteProvider').returns({
      sendTransaction: broadcast,
      getTransactionCount: sinon.stub().resolves(NONCE),
      // enough for any boost, so planBoost never lowers a value
      getBalance: sinon.stub().resolves(BigNumber.from(10).pow(18)),
    } as unknown as providers.Provider);

    transactionManager = new TransactionManager({
      managerKeyManager,
      workersKeyManager,
      txStoreManager,
    });
  });

  afterEach(function () {
    sinon.restore();
  });

  function sendRelayTransaction() {
    return transactionManager.sendTransaction({
      signer: WORKER_ADDRESS,
      serverAction: ServerAction.RELAY_CALL,
      destination: DESTINATION,
      gasLimit: BigNumber.from(100000),
      gasPrice: BigNumber.from(NODE_GAS_PRICE),
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
      broadcast.rejects(new Error('gas price above cap'));

      await expect(sendRelayTransaction()).to.be.rejectedWith(
        'gas price above cap'
      );

      expect(transactionManager.nonces[WORKER_ADDRESS]).to.equal(NONCE);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a sinon stub, not a method call
      expect(txStoreManager.removeTx).to.have.been.calledOnceWith(
        sinon.match({ txId: TX_HASH, nonce: NONCE })
      );
    });

    it('should reuse the nonce of a refused transaction for the next one', async function () {
      broadcast.onFirstCall().rejects(new Error('gas price above cap'));
      broadcast.onSecondCall().resolves({ hash: TX_HASH });

      await expect(sendRelayTransaction()).to.be.rejected;
      await expect(sendRelayTransaction()).to.be.fulfilled;

      const [, firstTx] = workersKeyManager.signTransaction.firstCall.args;
      const [, secondTx] = workersKeyManager.signTransaction.secondCall.args;
      expect(firstTx.nonce).to.equal(NONCE);
      expect(secondTx.nonce).to.equal(NONCE);
      expect(transactionManager.nonces[WORKER_ADDRESS]).to.equal(NONCE + 1);
    });
  });

  describe('Function resendTransaction()', function () {
    it('should keep the transaction as last broadcast when the node refuses the boost', async function () {
      const storedTx = createStoredTx(BigNumber.from(100000000));
      broadcast.rejects(new Error('gas price above cap'));

      await expect(
        transactionManager.resendTransaction(
          storedTx,
          10,
          BigNumber.from(120000000),
          false
        )
      ).to.be.rejectedWith('gas price above cap');

      expect(txStoreManager.putTx.firstCall).to.have.been.calledWith(
        sinon.match({ txId: TX_HASH, attempts: 2 }),
        true
      );
      expect(txStoreManager.putTx.lastCall).to.have.been.calledWith(
        storedTx,
        true
      );
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
  });
});
