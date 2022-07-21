import {
    ContractInteractor,
    ForwardRequest,
    RelayData,
    RelayMetadata,
    RelayTransactionRequest
} from '@rsksmart/rif-relay-common';
import { expect, use } from 'chai';
import Sinon, { createStubInstance, SinonStubbedInstance, stub } from 'sinon';
import sinonChai from 'sinon-chai';
import { stubInterface } from 'ts-sinon';
import { toBN } from 'web3-utils';
import {
    KeyManager,
    RelayServer,
    ServerDependencies,
    TxStoreManager
} from '../../src';
import * as conversions from '../../src/Conversions';

use(sinonChai);

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
            const server = new RelayServer({}, mockDependencies);

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

        let server: RelayServer;
        const examplePrice = toBN(10).pow(toBN(14));

        const setMaxGas = (price: number) => fakeContractInteractor.estimateRelayTransactionMaxPossibleGasWithTransactionRequest.returns(
                Promise.resolve(price)
            );

        beforeEach(() => {
            server = new RelayServer({}, mockDependencies);
        });

        it('should return gas price as is if sponsoredTxFee = 0', async () => {
            const expectedGasPrice = examplePrice;
            setMaxGas(expectedGasPrice.toNumber());
            const actualGasPrice = await server.getMaxPossibleGas(
                fakeRelayTransactionRequest,
                false
            );

            expect(actualGasPrice.eq(expectedGasPrice)).to.be.true;
        });

        it('should throw `User agreed to spend lower than what the transaction may require.` if tokenAmount < max gas + sponsor fee', async () => {
            setMaxGas(50);
            const fakeGetGas = Sinon.fake.returns(toBN(5));
            server.config.sponsoredTxFee = '100';
            Sinon.replace(conversions, 'getGas',( () => {
                console.log('FUCK THE SYSTEM'); 
                return fakeGetGas;
            }) as unknown as (cost: BN, gasPrice: BN) => BN);
            
            expect(async() => await server.getMaxPossibleGas(
                fakeRelayTransactionRequest,
                false
            )).to.throw('User agreed to spend lower than what the transaction may require.');
        });
        
    });
});
