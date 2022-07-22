import {
    ContractInteractor,
    ForwardRequest,
    RelayData,
    RelayMetadata,
    RelayTransactionRequest
} from '@rsksmart/rif-relay-common';
import BigNumber from 'bignumber.js';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import Sinon, { createStubInstance, SinonSpy, SinonStubbedInstance, stub } from 'sinon';
import sinonChai from 'sinon-chai';
import { stubInterface } from 'ts-sinon';
import { toBN } from 'web3-utils';
import {
    KeyManager,
    RelayServer,
    ServerConfigParams,
    ServerDependencies,
    TxStoreManager
} from '../../src';
import * as conversions from '../../src/Conversions';

use(sinonChai);
use(chaiAsPromised);

describe('RelayServer', () => {
    let fakeManagerKeyManager: SinonStubbedInstance<KeyManager> & KeyManager;
    let fakeWorkersKeyManager: SinonStubbedInstance<KeyManager> & KeyManager;
    let fakeContractInteractor: SinonStubbedInstance<ContractInteractor> &
        ContractInteractor;
    let fakeTxStoreManager: SinonStubbedInstance<TxStoreManager> & TxStoreManager;
    let mockDependencies: ServerDependencies;

    beforeEach(() => {
        fakeManagerKeyManager = createStubInstance(KeyManager, {
            getAddress: stub(),
        });
        fakeManagerKeyManager.getAddress.returns('fake_address');

        fakeWorkersKeyManager = createStubInstance(KeyManager, {
            getAddress: stub(),
        });
        fakeWorkersKeyManager.getAddress.returns('fake_address');

        fakeContractInteractor = createStubInstance(ContractInteractor);

        fakeTxStoreManager = createStubInstance(TxStoreManager);

        mockDependencies = {
            managerKeyManager: fakeManagerKeyManager,
            workersKeyManager: fakeWorkersKeyManager,
            contractInteractor: fakeContractInteractor,
            txStoreManager: fakeTxStoreManager,
        };
    });

    describe('constructor', () => {
        it('should call getAddress of key managers', () => {
            const server = new RelayServer({
                logLevel: 1
            }, mockDependencies);

            expect(server, 'Is instance of RelayServer').to.be.instanceOf(
                RelayServer
            );

            expect(fakeManagerKeyManager.getAddress, 'Calls manager getAddress').to
                .have.been.called;
            expect(fakeWorkersKeyManager.getAddress, 'Calls workers getAddress').to
                .have.been.called;
        });
    });

    describe('getMaxPossibleGas', async () => {
        const fakeRelayTransactionRequest: RelayTransactionRequest = {
            relayRequest: {
                relayData: {
                    gasPrice: '0',
                    callForwarder: 'fake_address',
                } as RelayData,
                request: {
                    to: 'fake_address',
                    data: 'fake_data',
                    gas: '1',
                } as ForwardRequest,
            },
            metadata: stubInterface<RelayMetadata>(),
        };

        const examplePrice = toBN(10).pow(toBN(14));

        const setMaxGas = (price: number) => fakeContractInteractor.estimateRelayTransactionMaxPossibleGasWithTransactionRequest.returns(
            Promise.resolve(price)
        );

        it('should return gas price as is if sponsoredTxFee = 0', async () => {
            const expectedGasPrice = examplePrice;
            setMaxGas(expectedGasPrice.toNumber());

            const server = new RelayServer({}, mockDependencies);
            const actualGasPrice = await server.getMaxPossibleGas(
                fakeRelayTransactionRequest,
                false
            );

            expect(actualGasPrice.eq(expectedGasPrice)).to.be.true;
        });

        afterEach(() => {
            Sinon.restore();
        });

        it('should throw `User agreed to spend lower than what the transaction may require.` if tokenAmount < gas + gas * fee', async () => {
            setMaxGas(50);
            const fakeGetGas = Sinon.fake.returns(toBN(5));
            const payedTokens = '10';

            const server = new RelayServer({
                workerFeePercentage: '0.25'
            }, mockDependencies);
            Sinon.replace(conversions, 'getGas', fakeGetGas);
            fakeRelayTransactionRequest.relayRequest.request.tokenAmount = payedTokens;

            expect(server.getMaxPossibleGas(
                fakeRelayTransactionRequest,
                false
            )).to.eventually.have.rejectedWith('User agreed to spend lower than what the transaction may require.');
        });

        it('should not throw `User agreed to spend lower than what the transaction may require.` if tokenAmount >= gas + gas * fee', async () => {
            const estimatedGas: BigNumber = conversions.normaliseFraction({ fraction: 3, precision: 7 }); // 3e7 gas is ethereum total block size gas limit
            setMaxGas(estimatedGas.toNumber());
            const workerFeePercentage: ServerConfigParams['workerFeePercentage'] = '0.05';

            const workerFee: BN = conversions.fractionToBN({
                fraction: conversions.normaliseFraction({ fraction: workerFeePercentage }).multipliedBy(estimatedGas),
                precision: -conversions.RBTC_CHAIN_DECIMALS
            });
            const fakeGas: BN = toBN(estimatedGas.toString()).add(workerFee);
            const fakeGetGas: SinonSpy = Sinon.fake.returns(fakeGas);

            const server = new RelayServer({
                workerFeePercentage
            }, mockDependencies);
            Sinon.replace(conversions, 'getGas', fakeGetGas);

            fakeRelayTransactionRequest.relayRequest.request.tokenAmount = fakeGas.toString();

            expect(server.getMaxPossibleGas(
                fakeRelayTransactionRequest,
                false
            )).to.not.eventually.have.rejectedWith('User agreed to spend lower than what the transaction may require.');
        });

        it('should include fee in final max gas estimation', async () => {
            const estimatedGas: BigNumber = conversions.normaliseFraction({ fraction: 3, precision: 7 }); // 3e7 gas is ethereum total block size gas limit
            setMaxGas(estimatedGas.toNumber());
            const workerFeePercentage: ServerConfigParams['workerFeePercentage'] = '10.0000001';

            const workerFee: BN = conversions.fractionToBN({
                fraction: conversions.normaliseFraction({ fraction: workerFeePercentage }).multipliedBy(estimatedGas),
                precision: -conversions.RBTC_CHAIN_DECIMALS
            });
            const fakeGas: BN = toBN(estimatedGas.toString()).add(workerFee);
            const fakeGetGas: SinonSpy = Sinon.fake.returns(fakeGas);

            const server = new RelayServer({
                workerFeePercentage
            }, mockDependencies);
            Sinon.replace(conversions, 'getGas', fakeGetGas);
            fakeRelayTransactionRequest.relayRequest.request.tokenAmount = fakeGas.toString();

            expect((await server.getMaxPossibleGas(
                fakeRelayTransactionRequest,
                false
            )).eq(fakeGas)).to.be.true;
        });

        it('should not reject if fee is 1e-18', async () => {
            const estimatedGas: BigNumber = conversions.normaliseFraction({ fraction: 3, precision: 7 }); // 3e7 gas is ethereum total block size gas limit
            setMaxGas(estimatedGas.toNumber());
            const workerFeePercentage: ServerConfigParams['workerFeePercentage'] = new BigNumber('1e-18').toFixed(18);

            const workerFee: BigNumber = conversions.normaliseFraction({
                fraction: conversions.normaliseFraction({ fraction: workerFeePercentage }).multipliedBy(estimatedGas),
                precision: -conversions.RBTC_CHAIN_DECIMALS
            });
            const expectedGas: BigNumber = estimatedGas.plus(workerFee);
            const fakeGetGas: SinonSpy = Sinon.fake.returns(toBN(expectedGas.toString()));

            const server = new RelayServer({
                workerFeePercentage
            }, mockDependencies);
            Sinon.replace(conversions, 'getGas', fakeGetGas);
            fakeRelayTransactionRequest.relayRequest.request.tokenAmount = expectedGas.toString();

            const actualGasPrice = new BigNumber((await server.getMaxPossibleGas(
                fakeRelayTransactionRequest,
                false
            )).toString());

            expect(actualGasPrice.eq(expectedGas)).to.be.true;
        });
    });
});
