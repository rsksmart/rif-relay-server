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
        const port = 8095;
        const fakeRelayServer = createStubInstance(RelayServer, {
            getMinGasPrice: gasPrice,
            validateMaxNonce: Promise.resolve()
        });
        fakeRelayServer.config = {
            url: 'http://localhost:8090'
        } as ServerConfigParams;
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

        it('should response with proper id and method result', async () => {
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

        it('should response with proper id and code 200 if method returns null', async () => {
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
    });
});
