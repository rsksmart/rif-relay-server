import AsyncNedb from 'nedb-async';
import log from 'loglevel';
import { isSameAddress } from './Utils';
import type { ServerAction, StoredTransaction } from './StoredTransaction';

// FIXME: replace hardcoded values with config or env vars
export const TXSTORE_FILENAME = 'txstore.db';

export class TxStoreManager {
  private readonly _txstore: AsyncNedb<StoredTransaction>;

  constructor({ workdir = '/tmp/test/', inMemory = false }) {
    this._txstore = new AsyncNedb({
      filename: inMemory ? undefined : `${workdir}/${TXSTORE_FILENAME}`,
      autoload: true,
      timestampData: true,
    });
    void this._txstore.asyncEnsureIndex({ fieldName: 'txId', unique: true });

    void this._txstore.asyncEnsureIndex({
      fieldName: 'nonceSigner',
      unique: true,
    });

    log.info(
      'Server database location:',
      inMemory ? 'memory' : `${workdir}/${TXSTORE_FILENAME}`
    );
  }

  async putTx(tx: StoredTransaction, updateExisting = false): Promise<void> {
    if (!tx || !tx.txId || !tx.attempts || tx.nonce === undefined) {
      throw new Error('Invalid tx:' + JSON.stringify(tx));
    }
    const nonceSigner = {
      nonce: tx.nonce,
      signer: tx.from.toLowerCase(),
    };
    const tx1: StoredTransaction = {
      ...tx,
      txId: tx.txId,
      nonceSigner,
    };

    const existing: StoredTransaction = await this._txstore.asyncFindOne({
      nonceSigner: tx1.nonceSigner,
    });

    if (existing && updateExisting) {
      await this._txstore.asyncUpdate({ txId: existing.txId }, { $set: tx1 });
    } else {
      await this._txstore.asyncInsert(tx1);
    }
  }

  /**
   * Only for testing
   */
  async getTxByNonce(
    signer: string,
    nonce: number
  ): Promise<StoredTransaction> {
    /*         ow(nonce, ow.any(ow.number, ow.string));
                ow(signer, ow.string); */

    return await this._txstore.asyncFindOne({
      nonceSigner: {
        signer: signer.toLowerCase(),
        nonce,
      },
    });
  }

  /**
   * Only for testing
   */
  async getTxById(txId: string): Promise<StoredTransaction> {
    /*  ow(txId, ow.string); */

    return await this._txstore.asyncFindOne({ txId: txId.toLowerCase() });
  }

  async getTxsUntilNonce(
    signer: string,
    nonce: number
  ): Promise<StoredTransaction[]> {
    return await this._txstore.asyncFind({
      $and: [
        { 'nonceSigner.nonce': { $lte: nonce } },
        { 'nonceSigner.signer': signer.toLowerCase() },
      ],
    });
  }

  async removeTxsUntilNonce(signer: string, nonce: number): Promise<unknown> {
    /*  ow(nonce, ow.number);
         ow(signer, ow.string); */

    return await this._txstore.asyncRemove(
      {
        $and: [
          { 'nonceSigner.nonce': { $lte: nonce } },
          { 'nonceSigner.signer': signer.toLowerCase() },
        ],
      },
      { multi: true }
    );
  }

  async clearAll(): Promise<void> {
    await this._txstore.asyncRemove({}, { multi: true });
  }

  async getAllBySigner(signer: string): Promise<StoredTransaction[]> {
    return (
      await this._txstore.asyncFind<StoredTransaction>({
        'nonceSigner.signer': signer.toLowerCase(),
      })
    ).sort(function (tx1, tx2) {
      return (tx1.nonce ?? 0) - (tx2.nonce ?? 0);
    });
  }

  async getAll(): Promise<StoredTransaction[]> {
    return (await this._txstore.asyncFind<StoredTransaction>({})).sort(
      function (tx1, tx2) {
        return (tx1.nonce ?? 0) - (tx2.nonce ?? 0);
      }
    );
  }

  async isActionPending(
    serverAction: ServerAction,
    destination: string | undefined = undefined
  ): Promise<boolean> {
    const allTransactions = await this.getAll();

    return (
      allTransactions.find(
        (it) =>
          it.minedBlockNumber == null &&
          it.serverAction === serverAction &&
          (destination == null || (it.to && isSameAddress(it.to, destination)))
      ) != null
    );
  }
}
