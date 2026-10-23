import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BigNumber } from 'ethers';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ServerAction, StoredTransaction } from '../../src/StoredTransaction';
import { TxStoreManager, TXSTORE_FILENAME } from '../../src/TxStoreManager';

use(chaiAsPromised);

const SIGNER = '0xAbCdEf0000000000000000000000000000000001';
const OTHER_SIGNER = '0xabcdef0000000000000000000000000000000002';

const createTx = (
  nonce: number,
  overrides: Partial<StoredTransaction> = {}
): StoredTransaction => ({
  txId: `0x${nonce.toString(16).padStart(64, '0')}`,
  from: SIGNER,
  to: '0x1234567890123456789012345678901234567890',
  nonce,
  attempts: 1,
  serverAction: ServerAction.RELAY_CALL,
  creationBlockNumber: 100 + nonce,
  gasLimit: BigNumber.from(100000),
  gasPrice: BigNumber.from(60000000),
  ...overrides,
});

describe('TxStoreManager', function () {
  let txStoreManager: TxStoreManager;

  beforeEach(function () {
    txStoreManager = new TxStoreManager({ inMemory: true });
  });

  it('should store a transaction and find it by nonce and by id', async function () {
    const tx = createTx(1);

    await txStoreManager.putTx(tx);

    const byNonce = await txStoreManager.getTxByNonce(SIGNER, 1);
    const byId = await txStoreManager.getTxById(tx.txId);

    expect(byNonce.txId).to.equal(tx.txId);
    expect(byId.txId).to.equal(tx.txId);
    expect(byNonce.nonceSigner).to.deep.equal({
      nonce: 1,
      signer: SIGNER.toLowerCase(),
    });
  });

  it('should return value, gasLimit and gasPrice as BigNumber', async function () {
    await txStoreManager.putTx(
      createTx(1, { value: BigNumber.from('1000000000000000000') })
    );

    const [stored] = await txStoreManager.getAll();

    expect(BigNumber.isBigNumber(stored?.value)).to.be.true;
    expect(BigNumber.isBigNumber(stored?.gasLimit)).to.be.true;
    expect(stored?.value?.toString()).to.equal('1000000000000000000');
    expect(stored?.gasLimit?.toNumber()).to.equal(100000);
    expect(stored?.gasPrice?.toNumber()).to.equal(60000000);
  });

  it('should reject a second transaction with the same nonce and signer', async function () {
    await txStoreManager.putTx(createTx(1));

    await expect(
      txStoreManager.putTx(createTx(1, { txId: `0x${'f'.repeat(64)}` }))
    ).to.be.rejected;
  });

  it('should update the transaction with the same nonce and signer when asked to', async function () {
    await txStoreManager.putTx(createTx(1));

    await txStoreManager.putTx(
      createTx(1, { attempts: 2, gasPrice: BigNumber.from(70000000) }),
      true
    );

    const all = await txStoreManager.getAll();

    expect(all).to.have.length(1);
    expect(all[0]?.attempts).to.equal(2);
    expect(all[0]?.gasPrice?.toNumber()).to.equal(70000000);
  });

  it('should return the transactions of a signer sorted by nonce', async function () {
    await txStoreManager.putTx(createTx(3));
    await txStoreManager.putTx(createTx(1));
    await txStoreManager.putTx(createTx(2));
    await txStoreManager.putTx(
      createTx(0, { from: OTHER_SIGNER, txId: `0x${'e'.repeat(64)}` })
    );

    const bySigner = await txStoreManager.getAllBySigner(SIGNER);

    expect(bySigner.map(({ nonce }) => nonce)).to.deep.equal([1, 2, 3]);
  });

  it('should get and remove the transactions of a signer up to a nonce', async function () {
    await txStoreManager.putTx(createTx(1));
    await txStoreManager.putTx(createTx(2));
    await txStoreManager.putTx(createTx(3));

    const untilTwo = await txStoreManager.getTxsUntilNonce(SIGNER, 2);
    await txStoreManager.removeTxsUntilNonce(SIGNER, 2);
    const remaining = await txStoreManager.getAll();

    expect(untilTwo.map(({ nonce }) => nonce).sort()).to.deep.equal([1, 2]);
    expect(remaining.map(({ nonce }) => nonce)).to.deep.equal([3]);
  });

  it('should remove a single transaction', async function () {
    const tx = createTx(1);
    await txStoreManager.putTx(tx);
    await txStoreManager.putTx(createTx(2));

    await txStoreManager.removeTx(tx);

    expect(
      (await txStoreManager.getAll()).map(({ nonce }) => nonce)
    ).to.deep.equal([2]);
  });

  it('should clear all the transactions', async function () {
    await txStoreManager.putTx(createTx(1));
    await txStoreManager.putTx(createTx(2));

    await txStoreManager.clearAll();

    expect(await txStoreManager.getAll()).to.be.empty;
  });

  it('should report an action as pending only while it is not mined', async function () {
    const destination = '0x1234567890123456789012345678901234567890';
    await txStoreManager.putTx(
      createTx(1, { serverAction: ServerAction.ADD_WORKER })
    );

    expect(
      await txStoreManager.isActionPending(ServerAction.ADD_WORKER, destination)
    ).to.be.true;
    expect(await txStoreManager.isActionPending(ServerAction.REGISTER_SERVER))
      .to.be.false;

    await txStoreManager.putTx(
      createTx(1, {
        serverAction: ServerAction.ADD_WORKER,
        minedBlockNumber: 200,
      }),
      true
    );

    expect(
      await txStoreManager.isActionPending(ServerAction.ADD_WORKER, destination)
    ).to.be.false;
  });

  describe('with a datastore file', function () {
    let workdir: string;

    beforeEach(function () {
      workdir = mkdtempSync(join(tmpdir(), 'txstore-'));
    });

    afterEach(function () {
      rmSync(workdir, { recursive: true, force: true });
    });

    it('should keep the transactions after reopening it', async function () {
      const first = new TxStoreManager({ workdir });
      await first.putTx(createTx(1));

      const reopened = new TxStoreManager({ workdir });

      expect((await reopened.getAll()).map(({ nonce }) => nonce)).to.deep.equal(
        [1]
      );
    });

    it('should load a datastore file written by nedb 1.8', async function () {
      // As nedb 1.8 persisted a transaction and its indexes, before the move to @seald-io/nedb
      const createdAt = { $$date: 1700000000000 };
      writeFileSync(
        join(workdir, TXSTORE_FILENAME),
        [
          {
            txId: createTx(5).txId,
            from: SIGNER,
            to: '0x1234567890123456789012345678901234567890',
            nonce: 5,
            attempts: 1,
            serverAction: ServerAction.RELAY_CALL,
            creationBlockNumber: 105,
            gasLimit: { _hex: '0x0186a0', _isBigNumber: true },
            gasPrice: { _hex: '0x03938700', _isBigNumber: true },
            nonceSigner: { nonce: 5, signer: SIGNER.toLowerCase() },
            _id: 'BvnhEJ6qUhBQr4Gr',
            createdAt,
            updatedAt: createdAt,
          },
          { $$indexCreated: { fieldName: 'txId', unique: true } },
          { $$indexCreated: { fieldName: 'nonceSigner', unique: true } },
        ]
          .map((line) => JSON.stringify(line))
          .join('\n') + '\n'
      );

      const stored = await new TxStoreManager({ workdir }).getTxByNonce(
        SIGNER,
        5
      );

      expect(stored.txId).to.equal(createTx(5).txId);
      expect(stored.gasLimit?.toNumber()).to.equal(100000);
      expect(stored.gasPrice?.toNumber()).to.equal(60000000);
    });
  });
});
