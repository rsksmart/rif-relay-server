import { Express, Request, Response } from 'express';
import { RelayServer } from './RelayServer';
export declare class HttpServer {
    private readonly port;
    readonly backend: RelayServer;
    app: Express;
    private serverInstance?;
    constructor(port: number, backend: RelayServer);
    start(): void;
    startBackend(): void;
    stop(): void;
    close(): void;
    rootHandler(req: any, res: any): Promise<void>;
    /**
     * @openapi
     * /getaddr:
     *   get:
     *     summary: It retrieves some useful information about the server status.
     *     description: It shows the information about the server status.
     *     parameters:
     *       - in: path
     *         name: verifier
     *         required: false
     *         description: The address of the verifier (Not used at the moment).
     *         schema:
     *           type: string
     *     responses:
     *       '200':
     *         description: Information about the currently running instance.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PingResponse'
     */
    pingHandler(req: Request, res: Response): Promise<void>;
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
    statusHandler(_: Request, res: Response): void;
    /**
     * @openapi
     * /relay:
     *   post:
     *     summary: It relay transactions.
     *     description: It receives transactions (deploy or forward transactions) and after performing all the checks it broadcast them to the `relayHub`.
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
    relayHandler(req: Request, res: Response): Promise<void>;
    /**
     * @openapi
     * /tokens:
     *   get:
     *     summary: It retrieves the accepted tokens.
     *     description: "It retrieves the accepted tokens of the specified verifier if any, otherwise, it retrieves the accepted tokens of all the verifiers in the format { <verifier_address>: [accepted_token_address_1, accepted_token_address_2]}"
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
    tokenHandler(req: Request, res: Response): Promise<void>;
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
    verifierHandler(_: Request, res: Response): Promise<void>;
}
