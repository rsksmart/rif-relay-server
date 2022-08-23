import { stub, createStubInstance, SinonStubbedInstance } from 'sinon';
import { use, assert, request, expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import chaiHttp from 'chai-http';
import {
    RelayServer,
    HttpServer,
    ServerDependencies,
    TxStoreManager,
    KeyManager,
    ServerConfigParams
} from '../src';
import { ContractInteractor } from '@rsksmart/rif-relay-common';

use(chaiAsPromised);
use(chaiHttp);

describe('HttpServer', () => {
    const fakeServerConfig: Partial<ServerConfigParams> = {
        url: 'http://localhost:8090'
    };
    const port = 8095;
    const gasPrice = 5;
    const method: keyof RelayServer = 'getMinGasPrice';
    let httpServer: HttpServer;
    let fakeRelayServer: RelayServer;
    let fakeKeyManager: SinonStubbedInstance<KeyManager>;
    let fakeContractInteractor: ContractInteractor;
    let fakeStoreManager: TxStoreManager;
    let mockDependencies: ServerDependencies;

    before(() => {
        fakeKeyManager = createStubInstance(KeyManager, {
            getAddress: 'fakeAddress'
        });
        mockDependencies = {
            managerKeyManager: fakeKeyManager,
            workersKeyManager: fakeKeyManager,
            contractInteractor: fakeContractInteractor,
            txStoreManager: fakeStoreManager
        };
        fakeRelayServer = new RelayServer(fakeServerConfig, mockDependencies);
        httpServer = new HttpServer(port, fakeRelayServer);
    });

    describe('processRootHandler', () => {
        it('should process method from relay server', async () => {
            stub(fakeRelayServer, method).returns(gasPrice);
            const result = await httpServer.processRootHandler(method, []);
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
        let fakeRequest;

        it('should fail if method does not exist', async () => {
            fakeRequest = {
                id: '1',
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

        it('should fail if no raw body is provided', async () => {
            const response = await request(httpServer.app).post('/');
            expect(
                response.body,
                'Response should include error'
            ).to.include.keys('error');
            expect(
                response.body.error.message,
                'Response should include error'
            ).to.includes('Missing properties');
        });

        it('should respond with json', async () => {
            fakeRequest = {
                id: '1',
                method: method,
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
    });
});
