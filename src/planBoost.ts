import { BigNumber, constants } from 'ethers';
import { ServerAction, StoredTransaction } from './StoredTransaction';

export type PlannedBoost = {
  transaction: StoredTransaction;
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
 * Picks the pending transactions to resend at the new gas price, and the value
 * to resend each one with.
 *
 * None of the transactions is mined, so the balance has to pay for all of
 * them in nonce order. A transfer of the whole balance (e.g. a withdrawal) is
 * worth the balance minus its fee at the old gas price, so at the new gas
 * price its value has to shrink by the extra fee or the node refuses the
 * replacement. A transfer the balance can still afford keeps its value.
 * @param pendingTxs The signer's pending transactions, sorted by nonce.
 * @param balance The signer's balance.
 * @param newGasPrice The gas price to resend the underpriced transactions at.
 * @returns The underpriced transactions, in nonce order, with their values.
 */
export function planBoost(
  pendingTxs: StoredTransaction[],
  balance: BigNumber,
  newGasPrice: BigNumber
): PlannedBoost[] {
  const plan: PlannedBoost[] = [];
  let available = balance;

  for (const transaction of pendingTxs) {
    const isUnderpriced = transaction.gasPrice?.lt(newGasPrice) ?? false;
    const gasPrice = isUnderpriced
      ? newGasPrice
      : transaction.gasPrice ?? constants.Zero;
    const fee = (transaction.gasLimit ?? constants.Zero).mul(gasPrice);
    const storedValue = transaction.value ?? constants.Zero;
    const value =
      isUnderpriced && canLowerValue(transaction)
        ? min(storedValue, subOrZero(available, fee))
        : storedValue;

    available = subOrZero(available, fee.add(value));
    if (isUnderpriced) {
      plan.push({ transaction, value });
    }
  }

  return plan;
}
