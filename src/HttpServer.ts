import type { EnvelopingTxRequest } from '@rsksmart/rif-relay-client';
import bodyParser from 'body-parser';
import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import type { Server } from 'http';
import jsonrpc, { Defined } from 'jsonrpc-lite';
import log from 'loglevel';
import configureDocumentation from './DocConfiguration';
import type { RelayServer } from './RelayServer';

export type RootHandlerRequestBody = {
  id?: number;
  method?: string;
  params?: Array<unknown>;
};

export type RootHandlerRequest = Request<
  ParamsDictionary,
  RootHandlerRequestBody,
  RootHandlerRequestBody
>;

export type WhitelistedRelayMethods = Pick<
  RelayServer,
  | 'getMinGasPrice'
  | 'isCustomReplenish'
  | 'getManagerBalance'
  | 'getWorkerBalance'
  | 'getAllHubEventsSinceLastScan'
  | 'isTrustedVerifier'
  | 'isReady'
  | 'validateMaxNonce'
>;

export type WhitelistedRelayMethod = keyof WhitelistedRelayMethods;

export const AVAILABLE_METHODS: Array<WhitelistedRelayMethod> = [
  'getMinGasPrice',
  'isCustomReplenish',
  'getManagerBalance',
  'getWorkerBalance',
  'getAllHubEventsSinceLastScan',
  'isTrustedVerifier',
  'isReady',
  'validateMaxNonce',
];

type AvailableRelayMethods = RelayServer[WhitelistedRelayMethod];

type AvailableRelayMethodParameters = Parameters<AvailableRelayMethods>;

export class HttpServer {
  private _app: Express;

  private _serverInstance?: Server;

  private _port: number;

  private _relayServer: RelayServer;

  constructor(port: number, relayServer: RelayServer) {
    this._port = port;
    this._relayServer = relayServer;
    this._app = express();
    this._app.use(cors());

    this._app.use(bodyParser.urlencoded({ extended: false }));
    this._app.use(bodyParser.json());
    /* eslint-disable @typescript-eslint/no-misused-promises */
    this._app.post('/', this.rootHandler.bind(this));
    this._app.get('/chain-info', this.getChainInfo.bind(this));
    this._app.get('/status', this.statusHandler.bind(this));
    this._app.get('/tokens', this.tokenHandler.bind(this));
    this._app.get('/contracts', this.destinationContractHandler.bind(this));
    this._app.get('/verifiers', this.verifierHandler.bind(this));
    this._app.post('/relay', this.relayHandler.bind(this));
    this._app.post('/estimate', this.estimateHandler.bind(this));
    configureDocumentation(this._app, this._relayServer.config.app.url);
    this._relayServer.once('removed', this.stop.bind(this));
    this._relayServer.once('unstaked', this.close.bind(this));
    /* eslint-enable */
    this._relayServer.on('error', (e) => {
      log.error('httpServer:', e);
    });
  }

  start(): void {
    if (this._serverInstance === undefined) {
      this._serverInstance = this._app.listen(this._port, () => {
        // We need to be sure that this line is always printed
        // because the tests wait for it to be logged.
        const args = ['Listening on port', this._port];
        console.log(...args);
        log.info(...args);
        this.startBackend();
      });
    }
  }

  startBackend(): void {
    try {
      this._relayServer.start();
    } catch (e) {
      log.error('relay task error', e);
    }
  }

  stop(): void {
    this._serverInstance?.close();
    log.info('Http server stopped.\nShutting down relay...');
  }

  close(): void {
    log.info('Stopping relay worker...');
    this._relayServer.stop();
  }

  // TODO: use this when changing to jsonrpc
  async rootHandler(
    { body }: RootHandlerRequest,
    res: Response
  ): Promise<void> {
    let status;
    let id = -1;
    try {
      if (!(body.id && body.method)) {
        throw Error('Body request requires id and method to be executed');
      }
      id = body.id;
      const result = (await this.processRootHandler(
        body.method as WhitelistedRelayMethod,
        body.params as AvailableRelayMethodParameters
      )) ?? { code: 200 };
      status = jsonrpc.success(id, result as Defined);
    } catch (e) {
      if (e instanceof Error) {
        let stack = e.stack as string;
        // remove anything after 'rootHandler'
        stack = stack.replace(/(rootHandler.*)[\s\S]*/, '$1');
        stack = stack.replace(/(processRootHandler.*)[\s\S]*/, '$1');
        status = jsonrpc.error(id, new jsonrpc.JsonRpcError(stack, -125));
      } else {
        log.error(e);
      }
    }
    res.send(status);
  }

  async processRootHandler(
    method: WhitelistedRelayMethod,
    params: AvailableRelayMethodParameters
  ) {
    if (!AVAILABLE_METHODS.includes(method)) {
      throw Error(
        `Implementation of method ${method} not available on backend!`
      );
    }

    return (
      this._relayServer[method] as (
        ...args: AvailableRelayMethodParameters[number][]
      ) => ReturnType<AvailableRelayMethods>
    )(...params);
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
  getChainInfo(_req: Request, res: Response): void {
    try {
      const hubInfo = this._relayServer.getChainInfo();
      res.send(hubInfo);
      log.info(
        `address ${
          hubInfo.relayWorkerAddress
        } sent. ready: ${hubInfo.ready.toString()}`
      );
    } catch (e) {
      if (e instanceof Error) {
        const message: string = e.message;
        res.send({ message });
        log.error(`ping handler rejected: ${message}`);
      } else {
        log.error(e);
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
   *                 transactionHash:
   *                   type: address
   *               example:
   *                  { signedTx: "0xf9036a1b8403e252e08301f9699466fa9feafb8db66fe2160ca7aeac7fc24e25438780b90304180e59260000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000028000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000003e252e0a81483953da7601ef828906dbab2e4baf21ddfd3d3c484fe7c43c55836c6c77200000000000000000000000074105590d404df3f384a099c2e55135281ca6b40000000000000000000000000eab5b9fa91aeffaa9c33f9b33d12ab7088fa7f6f0000000000000000000000005c6e96a84271ac19974c3e99d6c4be4318bfe48300000000000000000000000066fa9feafb8db66fe2160ca7aeac7fc24e254387000000000000000000000000cb8f8130e289946aec9a17b29819716b1e9e49980000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f5859303f76596dd558b438b18d0ce0e1660f3ea0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000411285a1fa3217b0b8ca9b23ee2404324c965af9bb3908199ffc8bc7a47f59cef9160a142da5269fa5b7bfa8a688c1a507bedeba0650f1d617b93c8ece598aba651c0000000000000000000000000000000000000000000000000000000000000062a053917eb36fd417620eb21f6fa35b701a9efa2dc4a39422c04e1469b21b1c0b63a010ff3e24bc8421bb801abb914c3f6031ecf99e7bb8d514eae77bbb7db8d1208c",
   *                    transactionHash: "0xb8c646c863ff648b6f75f05cbcd84625521ca802d397e6473ba8f5e00e65f169"
   *                  }
   */
  async relayHandler({ body }: Request, res: Response): Promise<void> {
    try {
      const { signedTx, txHash } =
        await this._relayServer.createRelayTransaction(
          body as EnvelopingTxRequest
        );
      res.send({ signedTx, txHash });
    } catch (e) {
      if (e instanceof Error) {
        res.send({ error: e.message });
        log.info('tx failed:', e);
      } else {
        log.error(e);
      }
    }
  }

  /**
   * @openapi
   * /estimate:
   *   post:
   *     summary: It estimate the mas possible gas in relay transaction.
   *     description: It receives transactions to be estimated (deploy or forward requests) and after performing all the checks, it estimates the gas consumption.
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
   *               value: {"relayRequest":{"request":{"relayHub":"0x66Fa9FEAfB8Db66Fe2160ca7aEAc7FC24e254387","to":"0x0000000000000000000000000000000000000000","data":"0x","from":"0xCB8F8130E289946aec9a17b29819716B1E9e4998","value":"0","nonce":"5","tokenAmount":"0","tokenGas":"0x00","tokenContract":"0xF5859303f76596dD558B438b18d0Ce0e1660F3ea","recoverer":"0x0000000000000000000000000000000000000000","index":"6"},"relayData":{"gasPrice":"65164000","callVerifier":"0x5C6e96a84271AC19974C3e99d6c4bE4318BfE483","callForwarder":"0xeaB5b9fA91aeFFaA9c33F9b33d12AB7088fa7f6f","feesReceiver":"0x74105590d404df3f384a099c2e55135281ca6b40"}},"metadata":{"relayHubAddress":"0x66Fa9FEAfB8Db66Fe2160ca7aEAc7FC24e254387","signature":"0x1285a1fa3217b0b8ca9b23ee2404324c965af9bb3908199ffc8bc7a47f59cef9160a142da5269fa5b7bfa8a688c1a507bedeba0650f1d617b93c8ece598aba651c","relayMaxNonce":30}}
   *             forward:
   *               summary: "Forward request example"
   *               value: {"relayRequest":{"request":{"relayHub":"0x66Fa9FEAfB8Db66Fe2160ca7aEAc7FC24e254387","to":"0xF5859303f76596dD558B438b18d0Ce0e1660F3ea","data":"0xa9059cbb000000000000000000000000cb8f8130e289946aec9a17b29819716b1e9e49980000000000000000000000000000000000000000000000000429d069189e0000","from":"0xCB8F8130E289946aec9a17b29819716B1E9e4998","value":"0","nonce":"1","gas":"16559","tokenAmount":"100000000000000000","tokenGas":"16559","tokenContract":"0xF5859303f76596dD558B438b18d0Ce0e1660F3ea"},"relayData":{"gasPrice":"65164000","callVerifier":"0x56ccdB6D312307Db7A4847c3Ea8Ce2449e9B79e9","callForwarder":"0xc3D55e5244b4aB3cFbF5BD41ad1A6C5bfF2381AD","feesReceiver":"0x74105590d404df3f384a099c2e55135281ca6b40"}},"metadata":{"relayHubAddress":"0x66Fa9FEAfB8Db66Fe2160ca7aEAc7FC24e254387","signature":"0x40c462a5a5ad1b87f0ff1a685b5f0884c712c9fb211763601efcf723c005122637e18d4483edd1164f759c38a3b0a39803898caa2a88a144038556ad34949d171b","relayMaxNonce":31}}
   *     responses:
   *       '200':
   *         description: "Object with data about the estimation and the requiredTokenAmount"
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 gasPrice:
   *                   type: string
   *                 estimation:
   *                   type: string
   *                 requiredTokenAmount:
   *                   type: string
   *                 requiredNativeAmount:
   *                   type: string
   *                 exchangeRate:
   *                   type: string
   *               example:
   *                  {
   *                    gasPrice: 60000000,
   *                    estimation: 193889,
   *                    requiredTokenAmount: 3500381604736193689,
   *                    exchangeRate: 0.00000332344907316948,
   *                    requiredNativeToken: 11633340000000
   *                  }
   */
  async estimateHandler(req: Request, res: Response): Promise<void> {
    try {
      const estimation = await this._relayServer.estimateMaxPossibleGas(
        req.body as EnvelopingTxRequest
      );
      res.send(estimation);
    } catch (e) {
      if (e instanceof Error) {
        res.send({ error: e.message });
        log.info('tx failed:', e);
      } else {
        log.error(e);
      }
    }
  }

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
  async tokenHandler(req: Request, res: Response): Promise<void> {
    try {
      const verifier = req.query['verifier'];
      const tokenResponse = await this._relayServer.tokenHandler(
        verifier?.toString()
      );
      res.send(tokenResponse);
    } catch (e) {
      if (e instanceof Error) {
        const message: string = e.message;
        res.send({ message });
        log.error(`token handler rejected: ${message}`);
      } else {
        log.error(e);
      }
    }
  }

  /**
   * @openapi
   * /contracts:
   *   get:
   *     summary: It retrieves the accepted destination contracts.
   *     description: "It retrieves the accepted destination contracts of the specified verifier if any, otherwise, it retrieves the accepted destination contracts of all the verifiers."
   *     parameters:
   *       - in: query
   *         name: verifier
   *         required: false
   *         description: The address of the verifier to use to retrieve the accepted destination contracts.
   *         schema:
   *           type: address
   *     responses:
   *       '200':
   *         description: "Accepted destination contracts by the verifier(s)"
   *         content:
   *           application/json:
   *             schema:
   *               description: "Object that has the verifier address as key and the list of the accepted destination contracts by each verifier as value"
   *               type: object
   *               additionalProperties:
   *                 title: Verifier address
   *                 type: array
   *                 description: List of destination contracts accepted by the verifier.
   *                 items:
   *                   type: address
   *                   description: Contract address
   *               example:
   *                 { "0x5159345aaB821172e795d56274D0f5FDFdC6aBD9": ["0x726ECC75d5D51356AA4d0a5B648790cC345985ED"], "0x1eD614cd3443EFd9c70F04b6d777aed947A4b0c4": ["0x726ECC75d5D51356AA4d0a5B648790cC345985ED"] }
   */
  async destinationContractHandler(req: Request, res: Response): Promise<void> {
    try {
      const verifier = req.query['verifier'];
      const tokenResponse = await this._relayServer.destinationContractHandler(
        verifier?.toString()
      );
      res.send(tokenResponse);
    } catch (e) {
      if (e instanceof Error) {
        const message: string = e.message;
        res.send({ message });
        log.error(`destination contract handler rejected: ${message}`);
      } else {
        log.error(e);
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
   *                     type: address
   *               example:
   *                 { trustedVerifiers: ["0x5159345aaB821172e795d56274D0f5FDFdC6aBD9", "0x1eD614cd3443EFd9c70F04b6d777aed947A4b0c4"] }
   */
  verifierHandler(_: Request, res: Response): void {
    try {
      const verifierResponse = this._relayServer.verifierHandler();
      res.send(verifierResponse);
    } catch (e) {
      if (e instanceof Error) {
        const message: string = e.message;
        res.send({ message });
        log.error(`verified handler rejected: ${message}`);
      } else {
        log.error(e);
      }
    }
  }
}
