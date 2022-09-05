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
    WhitelistedRelayMethod,
    SignedTransactionDetails
} from '../src';
import jsonrpc from 'jsonrpc-lite';

use(chaiAsPromised);

describe('HttpServer', () => {
    const gasPrice = 5;
    let httpServer: HttpServer;
    let fakeRelayServer: RelayServer;

    beforeEach(() => {
        const expectedConfig: ServerConfigParams = {
            url: 'http://localhost:8090'
        } as ServerConfigParams;
        const port = 8095;
        fakeRelayServer = createStubInstance(RelayServer, {
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
    });

    describe('RelayHandler', () => {
        const fakeResponseExpress: SinonStubbedInstance<Partial<Response>> = {
            send: stub()
        };
        let fakeRequestExpress: SinonStubbedInstance<Partial<Request>>;

        it('should return a reponse with signedTx and transactionHash in body', async () => {
            const fakeResponseRelayTransaction: SignedTransactionDetails = {
                signedTx:
                    '0xf9036a1b8403e252e08301f9699466fa9feafb8db66fe2160ca7aeac7fc24e25438780b90304180e59260000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000028000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000003e252e0a81483953da7601ef828906dbab2e4baf21ddfd3d3c484fe7c43c55836c6c77200000000000000000000000074105590d404df3f384a099c2e55135281ca6b40000000000000000000000000eab5b9fa91aeffaa9c33f9b33d12ab7088fa7f6f0000000000000000000000005c6e96a84271ac19974c3e99d6c4be4318bfe48300000000000000000000000066fa9feafb8db66fe2160ca7aeac7fc24e254387000000000000000000000000cb8f8130e289946aec9a17b29819716b1e9e49980000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f5859303f76596dd558b438b18d0ce0e1660f3ea0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000411285a1fa3217b0b8ca9b23ee2404324c965af9bb3908199ffc8bc7a47f59cef9160a142da5269fa5b7bfa8a688c1a507bedeba0650f1d617b93c8ece598aba651c0000000000000000000000000000000000000000000000000000000000000062a053917eb36fd417620eb21f6fa35b701a9efa2dc4a39422c04e1469b21b1c0b63a010ff3e24bc8421bb801abb914c3f6031ecf99e7bb8d514eae77bbb7db8d1208c',
                transactionHash:
                    '0xb8c646c863ff648b6f75f05cbcd84625521ca802d397e6473ba8f5e00e65f169'
            };

            fakeRelayServer.createRelayTransaction = () =>
                Promise.resolve(fakeResponseRelayTransaction);
            fakeRequestExpress = {
                body: {}
            };

            await httpServer.relayHandler(
                fakeRequestExpress as Request,
                fakeResponseExpress as Response
            );

            fakeResponseExpress.send?.calledOnceWithExactly(
                fakeResponseRelayTransaction
            );
        });
    });
});
