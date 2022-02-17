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
     *               value: {"relayRequest":{"request":{"relayHub":"0x66Fa9FEAfB8Db66Fe2160ca7aEAc7FC24e254387","to":"0x0000000000000000000000000000000000000000","data":"0x","from":"0xCB8F8130E289946aec9a17b29819716B1E9e4998","value":"0","nonce":"5","tokenAmount":"0","tokenGas":"0x00","tokenContract":"0xF5859303f76596dD558B438b18d0Ce0e1660F3ea","recoverer":"0x0000000000000000000000000000000000000000","index":"6"},"relayData":{"gasPrice":"65164000","callVerifier":"0x5C6e96a84271AC19974C3e99d6c4bE4318BfE483","domainSeparator":"0xa81483953da7601ef828906dbab2e4baf21ddfd3d3c484fe7c43c55836c6c772","callForwarder":"0xeaB5b9fA91aeFFaA9c33F9b33d12AB7088fa7f6f","relayWorker":"0x74105590d404df3f384a099c2e55135281ca6b40"}},"metadata":{"relayHubAddress":"0x66Fa9FEAfB8Db66Fe2160ca7aEAc7FC24e254387","signature":"0x1285a1fa3217b0b8ca9b23ee2404324c965af9bb3908199ffc8bc7a47f59cef9160a142da5269fa5b7bfa8a688c1a507bedeba0650f1d617b93c8ece598aba651c","relayMaxNonce":30}}
     *             forward:
     *               summary: "Forward request example"
     *               value: {"relayRequest":{"request":{"relayHub":"0x66Fa9FEAfB8Db66Fe2160ca7aEAc7FC24e254387","to":"0xF5859303f76596dD558B438b18d0Ce0e1660F3ea","data":"0xa9059cbb000000000000000000000000cb8f8130e289946aec9a17b29819716b1e9e49980000000000000000000000000000000000000000000000000429d069189e0000","from":"0xCB8F8130E289946aec9a17b29819716B1E9e4998","value":"0","nonce":"1","gas":"16559","tokenAmount":"100000000000000000","tokenGas":"16559","tokenContract":"0xF5859303f76596dD558B438b18d0Ce0e1660F3ea"},"relayData":{"gasPrice":"65164000","callVerifier":"0x56ccdB6D312307Db7A4847c3Ea8Ce2449e9B79e9","domainSeparator":"0x6c2c692f3161d8587aaceabe51a7569e16f267d57e928ee6947559582f9be4ea","callForwarder":"0xc3D55e5244b4aB3cFbF5BD41ad1A6C5bfF2381AD","relayWorker":"0x74105590d404df3f384a099c2e55135281ca6b40"}},"metadata":{"relayHubAddress":"0x66Fa9FEAfB8Db66Fe2160ca7aEAc7FC24e254387","signature":"0x40c462a5a5ad1b87f0ff1a685b5f0884c712c9fb211763601efcf723c005122637e18d4483edd1164f759c38a3b0a39803898caa2a88a144038556ad34949d171b","relayMaxNonce":31}}
     *     responses:
     *       '200':
     *         description: "An hash of the signed transaction."
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 signedTx:
     *                   type: address
     *               example:
     *                  signedTx: "0xf9036a1b8403e252e08301f9699466fa9feafb8db66fe2160ca7aeac7fc24e25438780b90304180e59260000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000028000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000003e252e0a81483953da7601ef828906dbab2e4baf21ddfd3d3c484fe7c43c55836c6c77200000000000000000000000074105590d404df3f384a099c2e55135281ca6b40000000000000000000000000eab5b9fa91aeffaa9c33f9b33d12ab7088fa7f6f0000000000000000000000005c6e96a84271ac19974c3e99d6c4be4318bfe48300000000000000000000000066fa9feafb8db66fe2160ca7aeac7fc24e254387000000000000000000000000cb8f8130e289946aec9a17b29819716b1e9e49980000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f5859303f76596dd558b438b18d0ce0e1660f3ea0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000411285a1fa3217b0b8ca9b23ee2404324c965af9bb3908199ffc8bc7a47f59cef9160a142da5269fa5b7bfa8a688c1a507bedeba0650f1d617b93c8ece598aba651c0000000000000000000000000000000000000000000000000000000000000062a053917eb36fd417620eb21f6fa35b701a9efa2dc4a39422c04e1469b21b1c0b63a010ff3e24bc8421bb801abb914c3f6031ecf99e7bb8d514eae77bbb7db8d1208c"
     */
    relayHandler(req: Request, res: Response): Promise<void>;
    /**
     * @openapi
     * /tokens:
     *   get:
     *     summary: It retrieves the accepted tokens.
     *     description: "It retrieves the accepted tokens of the specified verifier if any, otherwise, it retrieves the accepted tokens of all the verifiers."
     *     parameters:
     *       - in: query
     *         name: verifier
     *         required: false
     *         description: The address of the verifier to use to retrieve the accepted tokens.
     *         schema:
     *           type: address
     *     responses:
     *       '200':
     *         description: "Accepted tokens by the verifier(s)"
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
     *                   type: address
     *                   description: Token address
     *               example:
     *                 { "0x5159345aaB821172e795d56274D0f5FDFdC6aBD9": ["0x726ECC75d5D51356AA4d0a5B648790cC345985ED"], "0x1eD614cd3443EFd9c70F04b6d777aed947A4b0c4": ["0x726ECC75d5D51356AA4d0a5B648790cC345985ED"] }
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
     *                     type: address
     *               example:
     *                 { trustedVerifiers: ["0x5159345aaB821172e795d56274D0f5FDFdC6aBD9", "0x1eD614cd3443EFd9c70F04b6d777aed947A4b0c4"] }
     */
    verifierHandler(_: Request, res: Response): Promise<void>;
}
