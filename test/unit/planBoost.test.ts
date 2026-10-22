import { expect } from 'chai';
import { BigNumber, utils } from 'ethers';
import { planBoost } from '../../src/planBoost';
import { ServerAction, StoredTransaction } from '../../src/StoredTransaction';

const GAS_PRICE = BigNumber.from(60000000);
const NEW_GAS_PRICE = BigNumber.from(72000000);
const GAS_LIMIT = BigNumber.from(21000);
const OLD_FEE = GAS_LIMIT.mul(GAS_PRICE);
const NEW_FEE = GAS_LIMIT.mul(NEW_GAS_PRICE);
const BALANCE = utils.parseEther('0.001');

const pendingTx = (
  nonce: number,
  fields: Partial<StoredTransaction> = {}
): StoredTransaction => ({
  txId: `0x${nonce.toString(16).padStart(64, '0')}`,
  from: '0x00000000000000000000000000000000000000aa',
  to: '0x00000000000000000000000000000000000000dd',
  attempts: 1,
  serverAction: ServerAction.VALUE_TRANSFER,
  creationBlockNumber: 100,
  nonce,
  gasLimit: GAS_LIMIT,
  gasPrice: GAS_PRICE,
  value: BigNumber.from(0),
  ...fields,
});

describe('planBoost', function () {
  it('should keep the value of a transfer the balance can afford', function () {
    const value = utils.parseEther('0.0001');
    const transaction = pendingTx(0, { value });

    const [planned] = planBoost([transaction], BALANCE, NEW_GAS_PRICE);

    expect(planned?.transaction).to.be.equal(transaction);
    expect(planned?.gasPrice.eq(NEW_GAS_PRICE)).to.be.true;
    expect(planned?.value.eq(value)).to.be.true;
  });

  it('should lower the value of a whole-balance transfer by the extra fee', function () {
    const transaction = pendingTx(0, { value: BALANCE.sub(OLD_FEE) });

    const [planned] = planBoost([transaction], BALANCE, NEW_GAS_PRICE);

    expect(planned?.value.eq(BALANCE.sub(NEW_FEE))).to.be.true;
  });

  it('should leave a later transfer only what the earlier ones do not spend', function () {
    const firstValue = utils.parseEther('0.0006');
    const transactions = [
      pendingTx(0, { value: firstValue }),
      pendingTx(1, { value: utils.parseEther('0.0006') }),
    ];

    const [first, second] = planBoost(transactions, BALANCE, NEW_GAS_PRICE);

    expect(first?.value.eq(firstValue)).to.be.true;
    expect(second?.value.eq(BALANCE.sub(NEW_FEE).sub(firstValue).sub(NEW_FEE)))
      .to.be.true;
  });

  it('should not resend a later transaction already at the new gas price, but count what it spends', function () {
    const secondValue = utils.parseEther('0.0006');
    const transactions = [
      pendingTx(0),
      pendingTx(1, { gasPrice: NEW_GAS_PRICE, value: secondValue }),
      pendingTx(2, { value: utils.parseEther('0.0006') }),
    ];

    const plan = planBoost(transactions, BALANCE, NEW_GAS_PRICE);

    expect(plan.map(({ transaction }) => transaction.nonce)).to.be.deep.equal([
      0, 2,
    ]);
    expect(
      plan[1]?.value.eq(
        BALANCE.sub(NEW_FEE).sub(NEW_FEE).sub(secondValue).sub(NEW_FEE)
      )
    ).to.be.true;
  });

  it('should send the oldest transaction again at its own price and value when its price cannot be raised', function () {
    const ownGasPrice = NEW_GAS_PRICE.mul(2);
    const value = BALANCE.sub(GAS_LIMIT.mul(ownGasPrice));
    const transaction = pendingTx(0, { gasPrice: ownGasPrice, value });

    const [planned] = planBoost([transaction], BALANCE, NEW_GAS_PRICE);

    expect(planned?.transaction).to.be.equal(transaction);
    expect(planned?.gasPrice.eq(ownGasPrice)).to.be.true;
    expect(planned?.value.eq(value)).to.be.true;
  });

  it('should resend a transfer with value zero when the balance only covers the fee', function () {
    const transaction = pendingTx(0, { value: utils.parseEther('0.0001') });

    const [planned] = planBoost([transaction], NEW_FEE, NEW_GAS_PRICE);

    expect(planned?.value.isZero()).to.be.true;
  });

  it('should never lower the value of a transaction that is not a transfer', function () {
    const value = BALANCE.sub(OLD_FEE);
    const transaction = pendingTx(0, {
      serverAction: ServerAction.RELAY_CALL,
      value,
    });

    const [planned] = planBoost([transaction], BALANCE, NEW_GAS_PRICE);

    expect(planned?.value.eq(value)).to.be.true;
  });

  it('should resend a transaction stored without a value with value zero', function () {
    const transaction = pendingTx(0, { value: undefined });

    const [planned] = planBoost([transaction], BALANCE, NEW_GAS_PRICE);

    expect(planned?.value.isZero()).to.be.true;
  });
});
