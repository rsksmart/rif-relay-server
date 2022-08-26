<<<<<<< HEAD
import {
    stub,
    spy,
    createStubInstance,
    SinonStubbedInstance,
    SinonSpy
} from 'sinon';
import { use, assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Request, Response } from 'express';
import {
    RelayServer,
    HttpServer,
    ServerConfigParams,
    RootHandlerRequest,
    WhitelistedRelayMethod
} from '../src';
import jsonrpc from 'jsonrpc-lite';

use(chaiAsPromised);

describe('HttpServer', () => {
    const gasPrice = 5;
    let httpServer: HttpServer;

    beforeEach(() => {
        const expectedConfig: ServerConfigParams = {
            url: 'http://localhost:8090'
        } as ServerConfigParams;
        const port = 8095;
        const fakeRelayServer = createStubInstance(RelayServer, {
            getMinGasPrice: gasPrice,
            validateMaxNonce: Promise.resolve()
        });
        fakeRelayServer.config = expectedConfig;
        httpServer = new HttpServer(port, fakeRelayServer);
    });

    describe('processRootHandler', () => {
        it('should process method from relay server', async () => {
            const result = await httpServer.processRootHandler(
                'getMinGasPrice',
                []
            );
            assert.equal(result, gasPrice);
        });

        it('should fail if method does not exist', async () => {
            const method = 'method' as WhitelistedRelayMethod;
            const error = new Error(
                `Implementation of method ${method} not available on backend!`
            );
            await assert.isRejected(
                httpServer.processRootHandler(method, []),
                error.message
            );
        });
    });

    describe('rootHandler', () => {
        let jsonrpcSpy: SinonSpy;
        const fakeResponseExpress: SinonStubbedInstance<Partial<Response>> = {
            send: stub()
        };
        let fakeRequestExpress: SinonStubbedInstance<Partial<Request>>;
        let bodyRequest: RootHandlerRequest['body'];

        afterEach(() => {
            jsonrpcSpy.restore();
        });

        it('should fail if method does not exist', async () => {
            jsonrpcSpy = spy(jsonrpc, 'error');
            bodyRequest = {
                id: 1,
                method: 'method',
                params: []
            };
            fakeRequestExpress = {
                body: bodyRequest
            };
            await httpServer.rootHandler(
                fakeRequestExpress as Request,
                fakeResponseExpress as Response
            );
            assert.isTrue(
                jsonrpcSpy.calledOnceWith(bodyRequest.id),
                'Responded with different id'
            );
        });

        it('should fail if no id or method is provided in the request', async () => {
            jsonrpcSpy = spy(jsonrpc, 'error');
            fakeRequestExpress = {};
            await httpServer.rootHandler(
                fakeRequestExpress as Request,
                fakeResponseExpress as Response
            );
            assert.isTrue(
                jsonrpcSpy.calledOnceWith(-1),
                'Responded with id different from -1'
            );
        });

        it('should return a response with proper id and method result', async () => {
            jsonrpcSpy = spy(jsonrpc, 'success');
            bodyRequest = {
                id: 1,
                method: 'getMinGasPrice',
                params: []
            };
            fakeRequestExpress = {
                body: bodyRequest
            };
            await httpServer.rootHandler(
                fakeRequestExpress as Request,
                fakeResponseExpress as Response
            );
            assert.isTrue(jsonrpcSpy.calledOnceWith(bodyRequest.id, gasPrice));
        });

        it('should return a response with proper id and code 200 if method returns null', async () => {
            jsonrpcSpy = spy(jsonrpc, 'success');
            bodyRequest = {
                id: 1,
                method: 'validateMaxNonce',
                params: []
            };
            fakeRequestExpress = {
                body: bodyRequest
            };
            await httpServer.rootHandler(
                fakeRequestExpress as Request,
                fakeResponseExpress as Response
            );
            assert.isTrue(
                jsonrpcSpy.calledOnceWith(bodyRequest.id, { code: 200 })
            );
        });
=======
import { RelayServer } from '../src/RelayServer';
import { KeyManager } from '../src/KeyManager';
import { TxStoreManager } from '../src/TxStoreManager';
import { ContractInteractor } from '@rsksmart/rif-relay-common';
import { ServerDependencies } from '../src/ServerConfigParams';
import sinon, { createStubInstance, SinonStubbedInstance } from 'sinon';
import { assert } from 'chai';
import { toBN } from 'web3-utils';
import { TransactionManager } from '../src/TransactionManager';

const relayRequest = {
    relayRequest: {
        request: {
            relayHub: '0xb0082444317d7DE625fE4185025cc23Abb0501dD',
            to: '0x0000000000000000000000000000000000000000',
            data: '0x',
            from: '0x7dfB4Da87d1e56f5896DFf1a3856652cBB0af86F',
            value: '0',
            nonce: '0',
            tokenAmount: '0',
            tokenGas: '0x00',
            tokenContract: '0x2e9BD804A61255B2cC7106F915eD59AF5fBF63Cd',
            recoverer: '0x0000000000000000000000000000000000000000',
            index: '1'
        },
        relayData: {
            gasPrice: '60000000',
            callVerifier: '0x3715acae94733f70C8440B56A78b27808E96147c',
            callForwarder: '0x9A9E1e6cfD290A1783150758892e4E31923a3e18',
            relayWorker: '0xebde06750bcd12d41566133e3ae498eb7a4b386b'
        }
    },
    metadata: {
        relayHubAddress: '0xb0082444317d7DE625fE4185025cc23Abb0501dD',
        signature:
            '0xd1fedb3e4065e565f08653be4a9722d4ee65575aca96e9d199c749536ee189f810b893e6ab957cf4d56decec7bdac198c486ccf1c4377f0797689fd8d64147911c',
        relayMaxNonce: 3
    }
};

const transactionTestResponse = {
    transactionHash: 'transactionHashTest',
    signedTx: 'signedTxTest'
};

describe('Relay Server Test', () => {
    it('relay should return signedTx and transactionHash', async () => {
        const stubConfig: any = {};
        const managerKeyManagerStub: SinonStubbedInstance<KeyManager> =
            createStubInstance(KeyManager);
        const workersKeyManagerStub: SinonStubbedInstance<KeyManager> =
            createStubInstance(KeyManager);
        const contractInteractorStub: SinonStubbedInstance<ContractInteractor> =
            createStubInstance(ContractInteractor);
        const txStoreManagerStub: SinonStubbedInstance<TxStoreManager> =
            createStubInstance(TxStoreManager);
        const IRelayHubInstanceStub: any = {};
        const transactionManagerStub: SinonStubbedInstance<TransactionManager> =
            createStubInstance(TransactionManager);

        IRelayHubInstanceStub.address = relayRequest.metadata.relayHubAddress;
        IRelayHubInstanceStub.contract = {
            methods: {
                deployCall: () => ''
            }
        };

        workersKeyManagerStub.getAddress.returns(
            relayRequest.relayRequest.relayData.relayWorker
        );
        transactionManagerStub.sendTransaction.resolves({
            ...transactionTestResponse
        });
        const dependencies: ServerDependencies = {
            txStoreManager: txStoreManagerStub,
            managerKeyManager: managerKeyManagerStub,
            workersKeyManager: workersKeyManagerStub,
            contractInteractor: contractInteractorStub
        };

        const relayServer = new RelayServer(stubConfig, dependencies);
        relayServer.setReadyState(true);
        relayServer.relayHubContract = IRelayHubInstanceStub;
        relayServer.transactionManager = transactionManagerStub;
        sinon.stub(relayServer, 'validateRequestWithVerifier').resolves({
            maxPossibleGas: toBN(20)
        });
        sinon.stub(relayServer, 'validateViewCallSucceeds');
        sinon.stub(relayServer, 'replenishServer');

        const txInfo = await relayServer.createRelayTransaction(relayRequest);

        assert.hasAllKeys(txInfo, ['signedTx', 'transactionHash']);
        assert.equal(txInfo.signedTx, transactionTestResponse.signedTx);
        assert.equal(
            txInfo.transactionHash,
            transactionTestResponse.transactionHash
        );
>>>>>>> cc91817 (fixing dependencies)
    });
});
