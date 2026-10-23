import { BigNumber, constants } from 'ethers';
import { ServerAction, StoredTransaction } from './StoredTransaction';

export type PlannedBoost = {
  transaction: StoredTransaction;
  // the gas price to resend the transaction at
  gasPrice: BigNumber;
  // the value to resend the transaction with
  value: BigNumber;
};

const min = (a: BigNumber, b: BigNumber) => (a.lt(b) ? a : b);

const subOrZero = (a: BigNumber, b: BigNumber) =>
  a.gt(b) ? a.sub(b) : constants.Zero;

/**
 * Only a plain RBTC transfer still does its job with less value; lowering the
 * value of a contract call would change what the call does.
 */
const canLowerValue = ({ serverAction }: StoredTransaction) =>
  serverAction === ServerAction.VALUE_TRANSFER;

/**
 * Picks the pending transactions to send again, and the gas price and value to
 * send each one with. Every transaction priced below the new gas price is
 * boosted to it. The oldest one is sent again even when its price can't be
 * raised, since its broadcast may never have reached the node; at its own
 * price and value it signs to the same hash.
 *
 * None of the transactions is mined, so the balance has to pay for all of
 * them in nonce order. A transfer of the whole balance (e.g. a withdrawal) is
 * worth the balance minus its fee at the old gas price, so at the new gas
 * price its value has to shrink by the extra fee or the node refuses the
 * replacement. A transfer the balance can still afford keeps its value.
 * @param pendingTxs The signer's pending transactions, sorted by nonce.
 * @param balance The signer's balance.
 * @param newGasPrice The gas price to resend the underpriced transactions at.
 * @param lowerOldestTo The gas price to send the oldest transaction at when
 * its own is higher: a node that doesn't have it takes any price it accepts.
 * @returns The transactions to send again, in nonce order.
 */
export function planBoost(
  pendingTxs: StoredTransaction[],
  balance: BigNumber,
  newGasPrice: BigNumber,
  lowerOldestTo?: BigNumber
): PlannedBoost[] {
  const plan: PlannedBoost[] = [];
  const [oldestTx] = pendingTxs;
  let available = balance;

  for (const transaction of pendingTxs) {
    const isUnderpriced = transaction.gasPrice?.lt(newGasPrice) ?? false;
    const ownGasPrice = transaction.gasPrice ?? newGasPrice;
    let gasPrice = isUnderpriced ? newGasPrice : ownGasPrice;
    if (transaction === oldestTx && lowerOldestTo?.lt(gasPrice)) {
      gasPrice = lowerOldestTo;
    }
    const fee = (transaction.gasLimit ?? constants.Zero).mul(gasPrice);
    const storedValue = transaction.value ?? constants.Zero;
    const value =
      isUnderpriced && canLowerValue(transaction)
        ? min(storedValue, subOrZero(available, fee))
        : storedValue;

    available = subOrZero(available, fee.add(value));
    if (isUnderpriced || transaction === oldestTx) {
      plan.push({ transaction, gasPrice, value });
    }
  }

  return plan;
}
