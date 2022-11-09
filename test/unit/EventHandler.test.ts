import { ContractInteractor } from '@rsksmart/rif-relay-common';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Server } from 'http';
import { createSandbox } from 'sinon';
import { StubbedInstance } from 'ts-sinon';
import { WebSocketServer, WebSocket } from 'ws';
import EventHandler from '../../src/EventHandler';

use(chaiAsPromised);

describe.only('EventHandler', function () {
    const sandbox = createSandbox();
    let eventHandler: EventHandler;
    let contractInteractor: StubbedInstance<ContractInteractor>;
    let server: StubbedInstance<Server>;

    describe('start', function () {
        beforeEach(function () {
            contractInteractor = sandbox.createStubInstance(ContractInteractor);
            server = sandbox.createStubInstance(Server);

            eventHandler = new EventHandler(contractInteractor, {
                deployVerifierAddress: 'address',
                relayVerifierAddress: 'address'
            });
        });

        afterEach(function () {
            sandbox.restore();
        });

        it('should be listening for new connections', function () {
            const spy = sandbox.spy(WebSocketServer.prototype, 'on');
            eventHandler.start(server);
            expect(spy.calledOnce).to.be.true;
        });

        it.skip('should be listening for new messages', function () {
            //
        });
    });

    describe('subscribe', function () {
        let client: StubbedInstance<WebSocket>;
        let events: Map<string, Set<WebSocket>>;

        beforeEach(function () {
            contractInteractor = sandbox.createStubInstance(ContractInteractor);
            server = sandbox.createStubInstance(Server);
            eventHandler = new EventHandler(contractInteractor, {
                deployVerifierAddress: 'address',
                relayVerifierAddress: 'address'
            });
            events = new Map();
            (
                eventHandler as unknown as {
                    _events: Map<string, Set<WebSocket>>;
                }
            )._events = events;
        });

        afterEach(function () {
            sandbox.restore();
        });

        it('should subscribe the client if event exists', function () {
            client = sandbox.createStubInstance(WebSocket);
            eventHandler.subscribe('relayAcceptedTokens', client);
            expect(events.size, 'client not subscribed').is.greaterThanOrEqual(
                1
            );
        });

        it('should not subscribe the client if event not exists', function () {
            client = sandbox.createStubInstance(WebSocket);
            eventHandler.subscribe('relayAccepted', client);
            expect(events.size, 'client subscribed').is.equal(0);
        });
    });

    describe('unsubscribe', function () {
        let client: StubbedInstance<WebSocket>;
        let events: Map<string, Set<WebSocket>>;

        beforeEach(function () {
            contractInteractor = sandbox.createStubInstance(ContractInteractor);
            server = sandbox.createStubInstance(Server);
            eventHandler = new EventHandler(contractInteractor, {
                deployVerifierAddress: 'address',
                relayVerifierAddress: 'address'
            });
            events = new Map();
            (
                eventHandler as unknown as {
                    _events: Map<string, Set<WebSocket>>;
                }
            )._events = events;
            client = sandbox.createStubInstance(WebSocket);
            eventHandler.subscribe('relayAcceptedTokens', client);
        });

        afterEach(function () {
            sandbox.restore();
        });

        it('shoud unsubscribe the client if event exists', function () {
            expect(events.size).is.equal(1);
            eventHandler.unsubscribe('relayAcceptedTokens', client);
            expect(events.size, 'client not unsubscribed').is.equal(0);
        });

        it('should not unsubscribe the client if the event not exists', function () {
            expect(events.size).is.equal(1);
            eventHandler.unsubscribe('relayAccepted', client);
            expect(events.size, 'client unsubscribed').is.equal(1);
        });
    });

    describe('queryBlockchain', function () {
        let events: Map<string, Set<WebSocket>>;

        beforeEach(function () {
            contractInteractor = sandbox.createStubInstance(ContractInteractor);
            server = sandbox.createStubInstance(Server);
            eventHandler = new EventHandler(contractInteractor, {
                deployVerifierAddress: 'address',
                relayVerifierAddress: 'address'
            });
            events = new Map();
            (
                eventHandler as unknown as {
                    _events: Map<string, Set<WebSocket>>;
                }
            )._events = events;
        });

        afterEach(function () {
            sandbox.restore();
        });

        it('should process the response', async function () {
            const stub = sandbox.stub().returns(undefined);
            const client = {
                readyState: 1,
                send: stub
            } as unknown as WebSocket;
            sandbox
                .stub(
                    eventHandler as unknown as {
                        _getAcceptedTokens: () => Promise<Array<string>>;
                    },
                    '_getAcceptedTokens'
                )
                .callsFake(() => Promise.resolve([]));
            eventHandler.subscribe('relayAcceptedTokens', client);
            await eventHandler.queryBlockchain();
            expect(stub.called).is.true;
        });

        it('should delete not active clients', function () {
            const client = {
                readyState: 1
            } as WebSocket;
            eventHandler.subscribe('relayAcceptedTokens', client);
            const client2 = {
                readyState: 2
            } as unknown as WebSocket;
            eventHandler.subscribe('relayAcceptedTokens', client2);
            const event = events.get('relayAcceptedTokens');
            expect(event?.size).is.greaterThanOrEqual(2);
            eventHandler.queryBlockchain();
            expect(event?.size).is.equal(1);
        });

        it('should delete not subscribed events', function () {
            const client = {
                readyState: 2
            } as WebSocket;
            eventHandler.subscribe('relayAcceptedTokens', client);
            expect(events.size).is.greaterThanOrEqual(1);
            eventHandler.queryBlockchain();
            expect(events.size).is.equal(0);
        });
    });
});
