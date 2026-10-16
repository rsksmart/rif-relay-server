import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon, { createStubInstance } from 'sinon';
import sinonChai from 'sinon-chai';
import { EventEmitter } from 'events';
import { BigNumber, constants, Wallet } from 'ethers';
import type { RelayHub, TypedEvent } from '@rsksmart/rif-relay-contracts';
import { RegistrationManager } from '../../src/RegistrationManager';
import { TransactionManager } from '../../src/TransactionManager';
import { TxStoreManager } from '../../src/TxStoreManager';
import { ServerAction } from '../../src/StoredTransaction';
import { getServerConfig } from '../../src/ServerConfigParams';
import * as serverUtils from '../../src/Utils';
import * as pastEvents from '../../src/getPastEventsForHub';

use(chaiAsPromised);
use(sinonChai);

describe('RegistrationManager', function () {
  let managerAddress: string;
  let workerAddress: string;
  let registrationManager: RegistrationManager;
  let workerToManager: sinon.SinonStub;
  let getStakeInfo: sinon.SinonStub;
  let isContractDeployed: sinon.SinonStub;
  let getPastEventsForHub: sinon.SinonStub;

  type StartupState = {
    _isInitialized: boolean;
    _isWorkerAdded: boolean;
    _delayedEvents: Array<{ block: number; eventData: TypedEvent }>;
  };
  const stateOf = (manager: RegistrationManager) =>
    manager as unknown as StartupState;

  const disabledEvent = (relayWorkers: string[]) =>
    ({
      event: 'RelayWorkersDisabled',
      args: { relayWorkers },
    } as unknown as TypedEvent);

  before(function () {
    managerAddress = Wallet.createRandom().address;
    workerAddress = Wallet.createRandom().address;
  });

  beforeEach(function () {
    workerToManager = sinon
      .stub()
      .resolves(BigNumber.from(managerAddress).shl(4).or(1));
    getStakeInfo = sinon.stub().resolves({
      stake: BigNumber.from(1),
      withdrawBlock: constants.Zero,
      unstakeDelay: BigNumber.from(1000),
      owner: Wallet.createRandom().address,
    });
    sinon.stub(serverUtils, 'getRelayHub').returns({
      getStakeInfo,
      workerToManager,
    } as unknown as RelayHub);
    isContractDeployed = sinon
      .stub(serverUtils, 'isContractDeployed')
      .resolves(true);
    sinon.stub(serverUtils, 'getRelayInfo').resolves([
      {
        manager: managerAddress,
        url: getServerConfig().app.url,
        registered: true,
        currentlyStaked: true,
      },
    ]);
    getPastEventsForHub = sinon
      .stub(pastEvents, 'getPastEventsForHub')
      .resolves([]);

    const txStoreManager = createStubInstance(TxStoreManager);
    txStoreManager.isActionPending.resolves(false);
    registrationManager = new RegistrationManager(
      createStubInstance(TransactionManager),
      txStoreManager,
      new EventEmitter(),
      managerAddress,
      workerAddress
    );
  });

  afterEach(function () {
    sinon.restore();
  });

  describe('initFromChain', function () {
    it('should read the state at the given block', async function () {
      await registrationManager.initFromChain(10);

      expect(getStakeInfo).to.be.calledWithExactly(managerAddress, {
        blockTag: 10,
      });
      expect(workerToManager).to.be.calledWithExactly(workerAddress, {
        blockTag: 10,
      });
      expect(stateOf(registrationManager)._isWorkerAdded).to.be.true;
      expect(stateOf(registrationManager)._isInitialized).to.be.true;
    });

    it('should start with empty state if the hub is not deployed at the given block', async function () {
      isContractDeployed.resolves(false);

      await registrationManager.initFromChain(10);

      expect(isContractDeployed).to.be.calledWith(sinon.match.string, 10);
      expect(getStakeInfo).not.to.be.called;
      expect(workerToManager).not.to.be.called;
      expect(stateOf(registrationManager)._isWorkerAdded).to.be.false;
      expect(stateOf(registrationManager)._isInitialized).to.be.true;
    });

    it('should not consider an unassigned worker as added', async function () {
      workerToManager.resolves(constants.Zero);

      await registrationManager.initFromChain(10);

      expect(stateOf(registrationManager)._isWorkerAdded).to.be.false;
    });

    it('should restore a pending stake unlock as a delayed event', async function () {
      const unlockEvent = {
        event: 'StakeUnlocked',
        blockNumber: 900,
      } as unknown as TypedEvent;
      getStakeInfo.resolves({
        stake: BigNumber.from(1),
        withdrawBlock: BigNumber.from(1900),
        unstakeDelay: BigNumber.from(1000),
        owner: Wallet.createRandom().address,
      });
      getPastEventsForHub.resolves([unlockEvent]);

      await registrationManager.initFromChain(1000);

      expect(getPastEventsForHub).to.be.calledWithExactly(
        managerAddress,
        { fromBlock: 900, toBlock: 1000 },
        ['StakeUnlocked']
      );
      expect(stateOf(registrationManager)._delayedEvents).to.be.deep.equal([
        { block: 1900, eventData: unlockEvent },
      ]);
    });

    it('should scan for the stake unlock from block 0 if the unstake delay was raised after it', async function () {
      getStakeInfo.resolves({
        stake: BigNumber.from(1),
        withdrawBlock: BigNumber.from(500),
        unstakeDelay: BigNumber.from(1000),
        owner: Wallet.createRandom().address,
      });

      await registrationManager.initFromChain(10);

      expect(getPastEventsForHub).to.be.calledWithExactly(
        managerAddress,
        { fromBlock: 0, toBlock: 10 },
        ['StakeUnlocked']
      );
      expect(stateOf(registrationManager)._delayedEvents).to.be.empty;
    });

    it('should fail if the worker is disabled', async function () {
      workerToManager.resolves(BigNumber.from(managerAddress).shl(4));

      await expect(registrationManager.initFromChain(10)).to.be.rejectedWith(
        /is disabled or assigned to another manager/
      );
    });

    it('should fail if the worker is assigned to another manager', async function () {
      workerToManager.resolves(
        BigNumber.from(Wallet.createRandom().address).shl(4).or(1)
      );

      await expect(registrationManager.initFromChain(10)).to.be.rejectedWith(
        /is disabled or assigned to another manager/
      );
    });
  });

  describe('handlePastEvents', function () {
    beforeEach(async function () {
      await registrationManager.initFromChain(10);
      await registrationManager.handlePastEvents([], 10, 11, false);
    });

    it('should not be registered once its worker is disabled', async function () {
      expect(registrationManager.isRegistered()).to.be.true;

      await registrationManager.handlePastEvents(
        [disabledEvent([workerAddress])],
        11,
        12,
        false
      );

      expect(registrationManager.isRegistered()).to.be.false;
    });

    it('should ignore the disabling of another worker', async function () {
      await registrationManager.handlePastEvents(
        [disabledEvent([Wallet.createRandom().address])],
        11,
        12,
        false
      );

      expect(registrationManager.isRegistered()).to.be.true;
    });

    it('should keep a due stake unlock until its withdrawal succeeds', async function () {
      const unlockEvent = {
        event: 'StakeUnlocked',
        transactionHash: '0xaa',
        logIndex: 0,
        args: { withdrawBlock: BigNumber.from(12) },
      } as unknown as TypedEvent;
      getPastEventsForHub.resolves([unlockEvent]);
      const withdrawAllFunds = sinon
        .stub(registrationManager, 'withdrawAllFunds')
        .onFirstCall()
        .rejects(new Error('getGasPrice failed'))
        .onSecondCall()
        .resolves(['0x01']);

      await expect(
        registrationManager.handlePastEvents([], 11, 12, false)
      ).to.be.rejectedWith('getGasPrice failed');
      expect(stateOf(registrationManager)._delayedEvents).to.be.deep.equal([
        { block: 12, eventData: unlockEvent },
      ]);

      // the failed poll didn't advance the scan cursor: the same log comes back
      const txHashes = await registrationManager.handlePastEvents(
        [],
        11,
        12,
        false
      );

      expect(withdrawAllFunds).to.be.calledTwice;
      expect(withdrawAllFunds.secondCall).to.be.calledWithExactly(false, 12);
      expect(txHashes).to.be.deep.equal(['0x01']);
      expect(stateOf(registrationManager)._delayedEvents).to.be.empty;
    });

    it('should not withdraw again while a value transfer is pending', async function () {
      stateOf(registrationManager)._delayedEvents.push({
        block: 12,
        eventData: { event: 'StakeUnlocked' } as unknown as TypedEvent,
      });
      const { _txStoreManager: txStoreManager } =
        registrationManager as unknown as {
          _txStoreManager: sinon.SinonStubbedInstance<TxStoreManager>;
        };
      txStoreManager.isActionPending
        .withArgs(ServerAction.VALUE_TRANSFER)
        .resolves(true);
      const withdrawAllFunds = sinon.stub(
        registrationManager,
        'withdrawAllFunds'
      );

      await registrationManager.handlePastEvents([], 11, 12, false);

      expect(withdrawAllFunds).not.to.be.called;
      expect(stateOf(registrationManager)._delayedEvents).to.have.length(1);
    });

    it('should not handle a stake unlock before it is due', async function () {
      stateOf(registrationManager)._delayedEvents.push({
        block: 20,
        eventData: { event: 'StakeUnlocked' } as unknown as TypedEvent,
      });
      const withdrawAllFunds = sinon.stub(
        registrationManager,
        'withdrawAllFunds'
      );

      await registrationManager.handlePastEvents([], 11, 12, false);

      expect(withdrawAllFunds).not.to.be.called;
      expect(stateOf(registrationManager)._delayedEvents).to.have.length(1);
    });
  });
});
