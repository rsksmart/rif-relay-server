import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon, { SinonStub } from 'sinon';
import { BigNumber, providers, utils } from 'ethers';
import { BigNumber as BigNumberJs } from 'bignumber.js';
import * as serverUtils from '../../src/Utils';
import { KeyManager } from '../../src/KeyManager';
import { TxStoreManager } from '../../src/TxStoreManager';
import { TransactionManager } from '../../src/TransactionManager';
import { ServerAction } from '../../src/StoredTransaction';
import { getServerConfig } from '../../src/ServerConfigParams';

use(chaiAsPromised);

const GAS_PRICE = BigNumber.from(60000000);
const GAS_LIMIT = BigNumber.from(21000);
const CREATION_BLOCK = 100;
const OWNER = '0x00000000000000000000000000000000000000dd';

describe('TransactionManager', function () {
  let transactionManager: TransactionManager;
  let txStoreManager: TxStoreManager;
  let worker: string;
  let balance: BigNumber;
  let broadcast: SinonStub;

  const boostedGasPrice = () => {
    const {
      blockchain: { retryGasPriceFactor, maxGasPrice },
    } = getServerConfig();
    const boosted = BigNumber.from(
      BigNumberJs(retryGasPriceFactor)
        .multipliedBy(GAS_PRICE.toString())
        .toFixed(0)
    );

    return boosted.gt(maxGasPrice) ? BigNumber.from(maxGasPrice) : boosted;
  };

  const boostBlock = () =>
    CREATION_BLOCK +
    getServerConfig().blockchain.pendingTransactionTimeoutBlocks;

  const sendTransfer = (value: BigNumber) =>
    transactionManager.sendTransaction({
      signer: worker,
      serverAction: ServerAction.VALUE_TRANSFER,
      destination: OWNER,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      value,
      creationBlockNumber: CREATION_BLOCK,
    });

  // the transactions the node received, decoded
  const broadcastTransactions = () =>
    broadcast.args.map(([signedTx]) =>
      utils.parseTransaction(signedTx as string)
    );

  beforeEach(function () {
    balance = utils.parseEther('0.001');
    broadcast = sinon
      .stub()
      .callsFake((signedTx: string) =>
        Promise.resolve({ hash: utils.keccak256(signedTx) })
      );
    const provider = {
      getGasPrice: () => Promise.resolve(GAS_PRICE),
      getNetwork: () => Promise.resolve({ chainId: 31 }),
      // nothing sent by the tests is mined
      getTransactionCount: () => Promise.resolve(0),
      getBalance: () => Promise.resolve(balance),
      sendTransaction: broadcast,
    } as unknown as providers.Provider;
    sinon.stub(serverUtils, 'getProvider').returns(provider);
    sinon.stub(serverUtils, 'getWriteProvider').returns(provider);

    txStoreManager = new TxStoreManager({ inMemory: true });
    const workersKeyManager = new KeyManager(1, undefined, '11'.repeat(32));
    transactionManager = new TransactionManager({
      managerKeyManager: new KeyManager(1, undefined, '22'.repeat(32)),
      workersKeyManager,
      txStoreManager,
    });
    worker = workersKeyManager.getAddress(0) as string;
  });

  afterEach(function () {
    sinon.restore();
  });

  // the broadcast of the original transaction fails, so it is only in the store
  const storeWithFailedBroadcast = async (value: BigNumber) => {
    broadcast.onCall(broadcast.callCount).rejects(new Error('node is down'));
    await expect(sendTransfer(value)).to.be.rejectedWith('node is down');
  };

  describe('sendTransaction', function () {
    it('should store the value of a transfer whose broadcast failed', async function () {
      const value = utils.parseEther('0.0001');

      await storeWithFailedBroadcast(value);

      const [storedTx] = await txStoreManager.getAllBySigner(worker);
      expect(storedTx?.value).to.be.instanceOf(BigNumber);
      expect(storedTx?.value?.eq(value)).to.be.true;
    });
  });

  describe('boostUnderpricedPendingTransactionsForSigner', function () {
    it('should resend a transfer with its value', async function () {
      const value = utils.parseEther('0.0001');
      await storeWithFailedBroadcast(value);

      await transactionManager.boostUnderpricedPendingTransactionsForSigner(
        worker,
        boostBlock()
      );

      const [, replacement] = broadcastTransactions();
      expect(replacement?.nonce).to.be.equal(0);
      expect(replacement?.gasPrice?.eq(boostedGasPrice())).to.be.true;
      expect(replacement?.value.eq(value)).to.be.true;
      const [storedTx] = await txStoreManager.getAllBySigner(worker);
      expect(storedTx?.value?.eq(value)).to.be.true;
    });

    it('should lower the value of a whole-balance transfer by the extra fee', async function () {
      // what _sendWorkersEthBalancesToOwner sends on a stake unlock
      await storeWithFailedBroadcast(balance.sub(GAS_LIMIT.mul(GAS_PRICE)));

      await transactionManager.boostUnderpricedPendingTransactionsForSigner(
        worker,
        boostBlock()
      );

      const [, replacement] = broadcastTransactions();
      const expectedValue = balance.sub(GAS_LIMIT.mul(boostedGasPrice()));
      expect(replacement?.value.eq(expectedValue)).to.be.true;
      expect(
        replacement?.value.add(GAS_LIMIT.mul(boostedGasPrice())).eq(balance)
      ).to.be.true;
      const [storedTx] = await txStoreManager.getAllBySigner(worker);
      expect(storedTx?.value?.eq(expectedValue)).to.be.true;
    });

    it('should fit the replacement in the balance the write node sees', async function () {
      await storeWithFailedBroadcast(balance.sub(GAS_LIMIT.mul(GAS_PRICE)));
      // the read node is behind a top-up the write node already has
      const writeBalance = balance.add(utils.parseEther('0.002'));
      const writeProvider = {
        getNetwork: () => Promise.resolve({ chainId: 31 }),
        getTransactionCount: () => Promise.resolve(0),
        getBalance: () => Promise.resolve(writeBalance),
        sendTransaction: broadcast,
      } as unknown as providers.Provider;
      (serverUtils.getWriteProvider as SinonStub).returns(writeProvider);

      await transactionManager.boostUnderpricedPendingTransactionsForSigner(
        worker,
        boostBlock()
      );

      const [original, replacement] = broadcastTransactions();
      expect(replacement?.value.eq(original?.value ?? 0)).to.be.true;
    });

    it('should leave a later transfer only what the earlier pending ones do not spend', async function () {
      const firstValue = utils.parseEther('0.0006');
      await storeWithFailedBroadcast(firstValue);
      await storeWithFailedBroadcast(utils.parseEther('0.0006'));

      await transactionManager.boostUnderpricedPendingTransactionsForSigner(
        worker,
        boostBlock()
      );

      const [, , first, second] = broadcastTransactions();
      const fee = GAS_LIMIT.mul(boostedGasPrice());
      expect(first?.nonce).to.be.equal(0);
      expect(first?.value.eq(firstValue)).to.be.true;
      expect(second?.nonce).to.be.equal(1);
      expect(second?.value.eq(balance.sub(fee).sub(firstValue).sub(fee))).to.be
        .true;
    });

    it('should resend a transaction stored without a value with value zero', async function () {
      await storeWithFailedBroadcast(utils.parseEther('0.0001'));
      // a record written before the value was stored
      const [storedTx] = await txStoreManager.getAllBySigner(worker);
      await txStoreManager.putTx(
        { ...storedTx, value: undefined } as NonNullable<typeof storedTx>,
        true
      );

      await transactionManager.boostUnderpricedPendingTransactionsForSigner(
        worker,
        boostBlock()
      );

      const [, replacement] = broadcastTransactions();
      expect(replacement?.value.isZero()).to.be.true;
    });
  });
});
