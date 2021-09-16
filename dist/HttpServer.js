"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpServer = void 0;
const express_1 = __importDefault(require("express"));
const jsonrpc_lite_1 = __importDefault(require("jsonrpc-lite"));
const body_parser_1 = __importDefault(require("body-parser"));
const cors_1 = __importDefault(require("cors"));
const loglevel_1 = __importDefault(require("loglevel"));
class HttpServer {
    constructor(port, backend) {
        this.port = port;
        this.backend = backend;
        this.app = (0, express_1.default)();
        this.app.use((0, cors_1.default)());
        this.app.use(body_parser_1.default.urlencoded({ extended: false }));
        this.app.use(body_parser_1.default.json());
        /* eslint-disable @typescript-eslint/no-misused-promises */
        this.app.post('/', this.rootHandler.bind(this));
        this.app.get('/getaddr', this.pingHandler.bind(this));
        this.app.get('/status', this.statusHandler.bind(this));
        this.app.get('/tokens', this.tokenHandler.bind(this));
        this.app.get('/verifiers', this.verifierHandler.bind(this));
        this.app.post('/relay', this.relayHandler.bind(this));
        this.backend.once('removed', this.stop.bind(this));
        this.backend.once('unstaked', this.close.bind(this));
        /* eslint-enable */
        this.backend.on('error', (e) => {
            console.error('httpServer:', e);
        });
    }
    start() {
        if (this.serverInstance === undefined) {
            this.serverInstance = this.app.listen(this.port, () => {
                console.log('Listening on port', this.port);
                this.startBackend();
            });
        }
    }
    startBackend() {
        try {
            this.backend.start();
        }
        catch (e) {
            loglevel_1.default.error('relay task error', e);
        }
    }
    stop() {
        var _a;
        (_a = this.serverInstance) === null || _a === void 0 ? void 0 : _a.close();
        console.log('Http server stopped.\nShutting down relay...');
    }
    close() {
        console.log('Stopping relay worker...');
        this.backend.stop();
    }
    // TODO: use this when changing to jsonrpc
    async rootHandler(req, res) {
        var _a;
        let status;
        try {
            let res;
            // @ts-ignore
            const func = this.backend[req.body.method];
            if (func != null) {
                res = (_a = (await func.apply(this.backend, [req.body.params]))) !== null && _a !== void 0 ? _a : {
                    code: 200
                };
            }
            else {
                // @ts-ignore
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                throw Error(`Implementation of method ${req.body.params} not found on backend!`);
            }
            status = jsonrpc_lite_1.default.success(req.body.id, res);
        }
        catch (e) {
            let stack = e.stack.toString();
            // remove anything after 'rootHandler'
            stack = stack.replace(/(rootHandler.*)[\s\S]*/, '$1');
            status = jsonrpc_lite_1.default.error(req.body.id, new jsonrpc_lite_1.default.JsonRpcError(stack, -125));
        }
        res.send(status);
    }
    async pingHandler(req, res) {
        try {
            const pingResponse = await this.backend.pingHandler(req.query.verifier);
            res.send(pingResponse);
            console.log(`address ${pingResponse.relayWorkerAddress} sent. ready: ${pingResponse.ready}`);
        }
        catch (e) {
            const message = e.message;
            res.send({ message });
            loglevel_1.default.error(`ping handler rejected: ${message}`);
        }
    }
    statusHandler(req, res) {
        // TODO: check components and return proper status code
        res.status(204).end();
    }
    async relayHandler(req, res) {
        try {
            const signedTx = (await this.backend.createRelayTransaction(req.body)).signedTx;
            res.send({ signedTx });
        }
        catch (e) {
            res.send({ error: e.message });
            console.log('tx failed:', e);
        }
    }
    async tokenHandler(req, res) {
        try {
            const verifier = req.query.verifier;
            const tokenResponse = await this.backend.tokenHandler(verifier);
            res.send(tokenResponse);
        }
        catch (e) {
            const message = e.message;
            res.send({ message });
            loglevel_1.default.error(`token handler rejected: ${message}`);
        }
    }
    async verifierHandler(req, res) {
        try {
            const verifierResponse = await this.backend.verifierHandler();
            res.send(verifierResponse);
        }
        catch (e) {
            const message = e.message;
            res.send({ message });
            loglevel_1.default.error(`verified handler rejected: ${message}`);
        }
    }
}
exports.HttpServer = HttpServer;
//# sourceMappingURL=HttpServer.js.map