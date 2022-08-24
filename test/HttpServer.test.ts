import { stub, createStubInstance, SinonStubbedInstance } from 'sinon';
import { use, assert, request, expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import chaiHttp from 'chai-http';
import { ContractInteractor } from '@rsksmart/rif-relay-common';
import {
    RelayServer,
    HttpServer,
    ServerDependencies,
    TxStoreManager,
    KeyManager,
    ServerConfigParams
} from '../src';
import { RootHandlerRequest } from '../src/types/HttpServer';

use(chaiAsPromised);
use(chaiHttp);

describe('HttpServer', () => {
    const fakeServerConfig: Partial<ServerConfigParams> = {
        url: 'http://localhost:8090'
    };
    const port = 8095;
    const gasPrice = 5;
    let httpServer: HttpServer;
    let relayServer: RelayServer;

    beforeEach(() => {
        const fakeKeyManager: SinonStubbedInstance<KeyManager> =
            createStubInstance(KeyManager, {
                getAddress: 'fakeAddress'
            });
        const fakeContractInteractor: SinonStubbedInstance<ContractInteractor> =
            createStubInstance(ContractInteractor);
        const fakeStoreManager: SinonStubbedInstance<TxStoreManager> =
            createStubInstance(TxStoreManager);
        const mockDependencies: ServerDependencies = {
            managerKeyManager: fakeKeyManager,
            workersKeyManager: fakeKeyManager,
            contractInteractor: fakeContractInteractor,
            txStoreManager: fakeStoreManager
        };
        relayServer = new RelayServer(fakeServerConfig, mockDependencies);
        httpServer = new HttpServer(port, relayServer);
    });

    describe('processRootHandler', () => {
        it('should process method from relay server', async () => {
            stub(relayServer, 'getMinGasPrice').returns(gasPrice);
            const result = await httpServer.processRootHandler(
                'getMinGasPrice',
                []
            );
            assert.equal(result, gasPrice);
        });

        it('should fail if method does not exist', async () => {
            const fakeMethod = 'fakeMethod';
            const error = new Error(
                `Implementation of method ${fakeMethod} not available on backend!`
            );
            await assert.isRejected(
                httpServer.processRootHandler(fakeMethod, []),
                error.message
            );
        });
    });

    describe('rootHandler', () => {
        let fakeRequest: RootHandlerRequest;

        it('should fail if method does not exist', async () => {
            fakeRequest = {
                id: 1,
                method: 'fakeMethod',
                params: []
            };
            const response = await request(httpServer.app)
                .post('/')
                .type('application/json')
                .send(fakeRequest);
            expect(
                response.body,
                'Response should include error'
            ).to.include.keys('error');
        });

        it('should fail if no id or method in the request is provided', async () => {
            const response = await request(httpServer.app).post('/');
            expect(
                response.body,
                'Response should include error'
            ).to.include.keys('error', 'id');
            expect(
                response.body.error.message,
                'Response should include error'
            ).to.includes('Missing properties');
        });

        it('should respond with json', async () => {
            fakeRequest = {
                id: 1,
                method: 'getMinGasPrice',
                params: []
            };
            const response = await request(httpServer.app)
                .post('/')
                .type('application/json')
                .send(fakeRequest);
            expect(
                response.body,
                'Response should include result'
            ).to.include.keys('result');
        });

        it('should respond with code 200', async () => {
            stub(relayServer, 'validateMaxNonce').returns(
                Promise.resolve(undefined)
            );
            fakeRequest = {
                id: 1,
                method: 'validateMaxNonce',
                params: [1]
            };
            const response = await request(httpServer.app)
                .post('/')
                .type('application/json')
                .send(fakeRequest);
            expect(
                response.body,
                'Response should include result'
            ).to.include.keys('result');
            assert.equal(response.body.result.code, 200);
        });
    });
});
