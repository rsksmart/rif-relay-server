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
const DocConfiguration_1 = __importDefault(require("./DocConfiguration"));
class HttpServer {
    constructor(port, backend) {
        this.port = port;
        this.backend = backend;
        this.app = express_1.default();
        this.app.use(cors_1.default());
        this.app.use(body_parser_1.default.urlencoded({ extended: false }));
        this.app.use(body_parser_1.default.json());
        /* eslint-disable @typescript-eslint/no-misused-promises */
        this.app.post('/', this.rootHandler.bind(this));
        this.app.get('/getaddr', this.pingHandler.bind(this));
        this.app.get('/status', this.statusHandler.bind(this));
        this.app.get('/tokens', this.tokenHandler.bind(this));
        this.app.get('/verifiers', this.verifierHandler.bind(this));
        this.app.post('/relay', this.relayHandler.bind(this));
        DocConfiguration_1.default(this.app, backend.config.url);
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
            if (e instanceof Error) {
                let stack = e.stack.toString();
                // remove anything after 'rootHandler'
                stack = stack.replace(/(rootHandler.*)[\s\S]*/, '$1');
                status = jsonrpc_lite_1.default.error(req.body.id, new jsonrpc_lite_1.default.JsonRpcError(stack, -125));
            }
            else {
                console.error(e);
            }
        }
        res.send(status);
    }
    /**
     * @openapi
     * /getaddr:
     *   get:
     *     summary: It retrieves server configuration addresses and some general data.
     *     description: It displays addresses used by the server, as well as chain information, status and version.
     *     responses:
     *       '200':
     *         description: Information about the currently running server instance.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PingResponse'
     */
    async pingHandler(req, res) {
        try {
            const pingResponse = await this.backend.pingHandler(req.query.verifier);
            res.send(pingResponse);
            console.log(`address ${pingResponse.relayWorkerAddress} sent. ready: ${pingResponse.ready}`);
        }
        catch (e) {
            if (e instanceof Error) {
                const message = e.message;
                res.send({ message });
                loglevel_1.default.error(`ping handler rejected: ${message}`);
            }
            else {
                console.error(e);
            }
        }
    }
    /**
     * @openapi
     * /status:
     *   get:
     *     summary: It returns a 204 response with an empty body.
     *     description: It may be used just to check if the server is running.
     *     responses:
     *       '204':
     *         description: No Content.
     */
    statusHandler(_, res) {
        // TODO: check components and return proper status code
        res.status(204).end();
    }
    /**
     * @openapi
     * /relay:
     *   post:
     *     summary: It relay transactions.
     *     description: It receives transactions to be relayed (deploy or forward requests) and after performing all the checks, it broadcasts them to the `relayHub`. For further information, please have a look at [Rif Relay architecture document](https://developers.rsk.co/rif/relay/architecture/)
     *     requestBody:
     *       description: Deploy transaction or forward transaction.
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             oneOf:
     *               - $ref: '#/components/schemas/DeployTransactionRequest'
     *               - $ref: '#/components/schemas/RelayTransactionRequest'
     *           examples:
     *             deploy:
     *               summary: "Deploy request example"
     *               value: {"relayRequest":{"request":{"relayHub":"0x<relay_hub>","to":"0x0000000000000000000000000000000000000000","data":"0x","from":"0x<from_address>","value":"0","nonce":"0","tokenAmount":"<token_amount>","tokenGas":"<token_gas>","tokenContract":"0x<token_contract>","recoverer":"0x0000000000000000000000000000000000000000","index":"1"},"relayData":{"gasPrice":"<gas_price>","callVerifier":"0x<call_verifier>","domainSeparator":"0x<domain_separator>","callForwarder":"0x<call_forwarder>","relayWorker":"0x<relay_worker>"}},"metadata":{"relayHubAddress":"0x<relay_hub>","signature":"0x<tx_signature>","relayMaxNonce":1}}
     *             forward:
     *               summary: "Forward request example"
     *               value: {"relayRequest":{"request":{"relayHub":"0x<relay_hub>","to":"0x<to_address>","data":"0x<call_data>","from":"0x<from_address>","value":"0","nonce":"0","gas":"<gas>","tokenAmount":"<token_amount>","tokenGas":"<token_gas>","tokenContract":"0x<token_contract>"},"relayData":{"gasPrice":"<gas_price>","callVerifier":"0x<call_verifier>","domainSeparator":"0x<domain_separator>","callForwarder":"0x<call_forwarder>","relayWorker":"0x<relay_worker>"}},"metadata":{"relayHubAddress":"0x<relay_hub>","signature":"0x<tx_signature>","relayMaxNonce":4}}
     *     responses:
     *       '200':
     *         description: "An hash of the signed transaction."
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 signedTx:
     *                   type: string
     *               example:
     *                  signedTx: "0x<signed_tx_hash>"
     */
    async relayHandler(req, res) {
        try {
            const signedTx = (await this.backend.createRelayTransaction(req.body)).signedTx;
            res.send({ signedTx });
        }
        catch (e) {
            if (e instanceof Error) {
                res.send({ error: e.message });
                console.log('tx failed:', e);
            }
            else {
                console.error(e);
            }
        }
    }
    /**
     * @openapi
     * /tokens:
     *   get:
     *     summary: It retrieves the accepted tokens.
     *     description: "It retrieves the accepted tokens of the specified verifier if any, otherwise, it retrieves the accepted tokens of all the verifiers in the format {<verifier_address>: [accepted_token_address_1, accepted_token_address_2, ...]}"
     *     parameters:
     *       - in: query
     *         name: verifier
     *         required: false
     *         description: The address of the verifier to use to retrieve the accepted tokens.
     *         schema:
     *           type: string
     *     responses:
     *       '200':
     *         description: "List of tokens accepted by the verifier(s) in the format { <verifier_address>: [accepted_token_address_1, accepted_token_address_2]}"
     *         content:
     *           application/json:
     *             schema:
     *               description: "Object that has the verifier address as key and the list of the accepted tokens by each verifier as value"
     *               type: object
     *               additionalProperties:
     *                 title: Verifier address
     *                 type: array
     *                 description: List of tokens accepted by the verifier.
     *                 items:
     *                   type: string
     *                   description: Token address
     *               example:
     *                 0x<verifier_address_1>: ["0x<token_address_1>", "0x<token_address_2>"]
     */
    async tokenHandler(req, res) {
        try {
            const verifier = req.query.verifier;
            const tokenResponse = await this.backend.tokenHandler(verifier);
            res.send(tokenResponse);
        }
        catch (e) {
            if (e instanceof Error) {
                const message = e.message;
                res.send({ message });
                loglevel_1.default.error(`token handler rejected: ${message}`);
            }
            else {
                console.error(e);
            }
        }
    }
    /**
     * @openapi
     * /verifiers:
     *   get:
     *     summary: It returns the list of the trusted verifiers
     *     description: "It returns the list of the trusted verifiers. 'Trusted' verifiers means that we trust `verifyRelayedCall` to be consistent: off-chain call and on-chain calls should either both succeed or both revert."
     *     responses:
     *       '200':
     *         description: "Trusted verifiers"
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               description: "Trusted verifiers"
     *               properties:
     *                 trustedVerifiers:
     *                   type: array
     *                   items:
     *                     type: string
     *               example:
     *                 trustedVerifiers: ["0x<verifier_address_1>", "0x<verifier_address_2>"]
     */
    async verifierHandler(_, res) {
        try {
            const verifierResponse = await this.backend.verifierHandler();
            res.send(verifierResponse);
        }
        catch (e) {
            if (e instanceof Error) {
                const message = e.message;
                res.send({ message });
                loglevel_1.default.error(`verified handler rejected: ${message}`);
            }
            else {
                console.error(e);
            }
        }
    }
}
exports.HttpServer = HttpServer;
//# sourceMappingURL=HttpServer.js.map