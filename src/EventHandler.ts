import { ContractInteractor } from '@rsksmart/rif-relay-common';
import { Server } from 'http';
import { RawData, Server as WebSocketServer, WebSocket } from 'ws';
import { ServerConfigParams } from './ServerConfigParams';

type EventResponse<T> = {
    event: string;
    data?: T;
};

type EventRequest = {
    event: string;
    action: 'subscribe' | 'unsubscribe';
};

const availableEvents = ['relayAcceptedTokens', 'deployAcceptedTokens'];

export default class EventHandler {
    private readonly _events: Map<string, Set<WebSocket>> = new Map();

    private readonly _contractInteractor: ContractInteractor;

    private _webSocketServer: WebSocketServer;

    private readonly _config: Partial<ServerConfigParams>;

    constructor(
        contractInteractor: ContractInteractor,
        config: Partial<ServerConfigParams>
    ) {
        this._contractInteractor = contractInteractor;
        this._config = config;
    }

    start(server: Server) {
        this._webSocketServer = new WebSocketServer({
            server,
            path: '/websocket'
        });
        this._webSocketServer.on('connection', (ws: WebSocket) => {
            ws.on('message', (message: RawData) => {
                const data: EventRequest = JSON.parse(message.toString());
                if (data.action === 'subscribe') {
                    this.subscribe(data.event, ws);
                } else if (data.action === 'unsubscribe') {
                    this.unsubscribe(data.event, ws);
                }
            });
        });
    }

    subscribe(eventName: string, client: WebSocket) {
        if (availableEvents.includes(eventName)) {
            if (this._events.has(eventName)) {
                this._events.get(eventName).add(client);
            } else {
                const clients = new Set<WebSocket>();
                clients.add(client);
                this._events.set(eventName, clients);
            }
        }
    }

    unsubscribe(eventName: string, client: WebSocket) {
        if (this._events.has(eventName)) {
            const event = this._events.get(eventName);
            event.delete(client);
            if (event.size === 0) {
                this._events.delete(eventName);
            }
        }
    }

    private async _getAcceptedTokens(address: string): Promise<Array<string>> {
        const verifier = await this._contractInteractor.createTokenHandler(
            address
        );
        const tokens = await verifier.contract.methods
            .getAcceptedTokens()
            .call();
        return tokens;
    }

    queryBlockchain() {
        for (const event of this._events) {
            for (const client of event[1]) {
                if (client.readyState === 1) {
                    this._processResponse(event[0], client);
                } else {
                    event[1].delete(client);
                }
            }
            if (event[1].size === 0) {
                this._events.delete(event[0]);
            }
        }
    }

    private async _processResponse(event: string, client: WebSocket) {
        let acceptedTokens: Array<string>;
        if (event === 'relayAcceptedTokens') {
            const { relayVerifierAddress } = this._config;
            acceptedTokens = await this._getAcceptedTokens(
                relayVerifierAddress
            );
        } else if (event === 'deployAcceptedTokens') {
            const { deployVerifierAddress } = this._config;
            acceptedTokens = await this._getAcceptedTokens(
                deployVerifierAddress
            );
        }
        const response: EventResponse<string> = {
            event,
            data: acceptedTokens.join(',')
        };
        client.send(JSON.stringify(response));
    }
}
