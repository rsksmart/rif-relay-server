import express, { Express, Request, Response } from 'express';
import jsonrpc from 'jsonrpc-lite';
import bodyParser from 'body-parser';
import cors from 'cors';
import { RelayServer } from './RelayServer';
import { Server } from 'http';
import log from 'loglevel';
import configureDocumentation from './DocConfiguration';

export class HttpServer {
    app: Express;
    private serverInstance?: Server;

    constructor(private readonly port: number, readonly backend: RelayServer) {
        this.app = express();
        this.app.use(cors());

        this.app.use(bodyParser.urlencoded({ extended: false }));
        this.app.use(bodyParser.json());
        /* eslint-disable @typescript-eslint/no-misused-promises */
        this.app.post('/', this.rootHandler.bind(this));
        this.app.get('/getaddr', this.pingHandler.bind(this));
        this.app.get('/status', this.statusHandler.bind(this));
        this.app.get('/tokens', this.tokenHandler.bind(this));
        this.app.get('/verifiers', this.verifierHandler.bind(this));
        this.app.post('/relay', this.relayHandler.bind(this));
        configureDocumentation(this.app);
        this.backend.once('removed', this.stop.bind(this));
        this.backend.once('unstaked', this.close.bind(this));
        /* eslint-enable */
        this.backend.on('error', (e) => {
            console.error('httpServer:', e);
        });
    }

    start(): void {
        if (this.serverInstance === undefined) {
            this.serverInstance = this.app.listen(this.port, () => {
                console.log('Listening on port', this.port);
                this.startBackend();
            });
        }
    }

    startBackend(): void {
        try {
            this.backend.start();
        } catch (e) {
            log.error('relay task error', e);
        }
    }

    stop(): void {
        this.serverInstance?.close();
        console.log('Http server stopped.\nShutting down relay...');
    }

    close(): void {
        console.log('Stopping relay worker...');
        this.backend.stop();
    }

    // TODO: use this when changing to jsonrpc
    async rootHandler(req: any, res: any): Promise<void> {
        let status;
        try {
            let res;
            // @ts-ignore
            const func = this.backend[req.body.method];
            if (func != null) {
                res = (await func.apply(this.backend, [req.body.params])) ?? {
                    code: 200
                };
            } else {
                // @ts-ignore
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                throw Error(
                    `Implementation of method ${req.body.params} not found on backend!`
                );
            }
            status = jsonrpc.success(req.body.id, res);
        } catch (e) {
            if (e instanceof Error) {
                let stack = e.stack.toString();
                // remove anything after 'rootHandler'
                stack = stack.replace(/(rootHandler.*)[\s\S]*/, '$1');
                status = jsonrpc.error(
                    req.body.id,
                    new jsonrpc.JsonRpcError(stack, -125)
                );
            } else {
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
     *     parameters:
     *       - in: path
     *         name: verifier
     *         required: false
     *         description: The address of the verifier (Not used at the moment).
     *         schema:
     *           type: string
     *     responses:
     *       '200':
     *         description: Information about the currently running server instance.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PingResponse'
     */
    async pingHandler(req: Request, res: Response): Promise<void> {
        try {
            const pingResponse = await this.backend.pingHandler(
                req.query.verifier as string
            );
            res.send(pingResponse);
            console.log(
                `address ${pingResponse.relayWorkerAddress} sent. ready: ${pingResponse.ready}`
            );
        } catch (e) {
            if (e instanceof Error) {
                const message: string = e.message;
                res.send({ message });
                log.error(`ping handler rejected: ${message}`);
            } else {
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
    statusHandler(_: Request, res: Response): void {
        // TODO: check components and return proper status code
        res.status(204).end();
    }

    /**
     * @openapi
     * /relay:
     *   post:
     *     summary: It relay transactions.
     *     description: It receives transactions to be relayed (deploy or forward requests) and after performing all the checks broadcasts them to the `relayHub`.
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
    async relayHandler(req: Request, res: Response): Promise<void> {
        try {
            const signedTx = (
                await this.backend.createRelayTransaction(req.body)
            ).signedTx;
            res.send({ signedTx });
        } catch (e) {
            if (e instanceof Error) {
                res.send({ error: e.message });
                console.log('tx failed:', e);
            } else {
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
     *       - in: path
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
    async tokenHandler(req: Request, res: Response): Promise<void> {
        try {
            const verifier = req.query.verifier as string;
            const tokenResponse = await this.backend.tokenHandler(verifier);
            res.send(tokenResponse);
        } catch (e) {
            if (e instanceof Error) {
                const message: string = e.message;
                res.send({ message });
                log.error(`token handler rejected: ${message}`);
            } else {
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
    async verifierHandler(_: Request, res: Response): Promise<void> {
        try {
            const verifierResponse = await this.backend.verifierHandler();
            res.send(verifierResponse);
        } catch (e) {
            if (e instanceof Error) {
                const message: string = e.message;
                res.send({ message });
                log.error(`verified handler rejected: ${message}`);
            } else {
                console.error(e);
            }
        }
    }
}
