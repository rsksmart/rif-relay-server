import express from 'express';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

/**
 * @swagger
 * components:
 *   schemas:
 *     PingResponse:
 *       type: object
 *       properties:
 *         relayWorkerAddress:
 *           type: address
 *           description: The address of the [relay worker](https://developers.rsk.co/rif/relay/architecture/#relay-worker).
 *         relayManagerAddress:
 *           type: address
 *           description: The address of the [relay manager](https://developers.rsk.co/rif/relay/architecture/#relay-manager).
 *         relayHubAddress:
 *           type: address
 *           description: The address of the [relay hub](https://developers.rsk.co/rif/relay/architecture/#relay-hub).
 *         minGasPrice:
 *           type: string
 *           description: Gas price of the current network.
 *         chainId:
 *           type: string
 *           description: Id of the network [To check differences with networkID].
 *         networkId:
 *           type: string
 *           description: Id of the network [To check differences with chainId].
 *         ready:
 *           type: boolean
 *           description: A field that that specifies if the server is ready to relay transactions.
 *         version:
 *           type: string
 *           description: String in semver format.
 *           example: 2.0.1
 *       example:
 *          { "relayWorkerAddress": "0x74105590d404df3f384a099c2e55135281ca6b40","relayManagerAddress": "0x4a6a175c1140f01679525ca3612364f5384cde46","relayHubAddress": "0x66Fa9FEAfB8Db66Fe2160ca7aEAc7FC24e254387","minGasPrice": "65164000","chainId": "31","networkId": "31","ready": true,"version": "2.0.1"}
 *     RelayTransactionRequest:
 *       type: object
 *       properties:
 *         relayRequest:
 *           $ref: '#/components/schemas/RelayRequest'
 *         metadata:
 *           $ref: '#/components/schemas/RelayMetadata'
 *     RelayRequest:
 *       type: object
 *       properties:
 *         request:
 *           $ref: '#/components/schemas/ForwardRequest'
 *         relayData:
 *           $ref: '#/components/schemas/RelayData'
 *     ForwardRequest:
 *       type: object
 *       properties:
 *         relayHub:
 *           type: address
 *           description: The address of the [relay hub](https://developers.rsk.co/rif/relay/architecture/#relay-hub).
 *         from:
 *           type: address
 *           description: The address of the EOA who signs the transaction.
 *         to:
 *           type: address
 *           description: The receiver of the transaction.
 *         tokenContract:
 *           type: address
 *           description: The address of the contract used to pay for the fees.
 *         value:
 *           type: string
 *         gas:
 *           type: string
 *         nonce:
 *           type: string
 *         tokenAmount:
 *           type: string
 *           description: The amount of the fees paid to execute the transaction.
 *         tokenGas:
 *           type: string
 *           description: The amount of gas required to transfer the fees.
 *         data:
 *           type: string
 *     DeployTransactionRequest:
 *       type: object
 *       properties:
 *         request:
 *           $ref: '#/components/schemas/DeployRequestStruct'
 *         relayData:
 *           $ref: '#/components/schemas/RelayData'
 *     DeployRequestStruct:
 *       type: object
 *       properties:
 *         relayHub:
 *           type: address
 *           description: The address of the [relay hub](https://developers.rsk.co/rif/relay/architecture/#relay-hub).
 *         from:
 *           type: address
 *           description: The address of the EOA who signs the transaction.
 *         to:
 *           type: address
 *           description: The receiver of the transaction.
 *         tokenContract:
 *           type: address
 *           description: The address of the contract used to pay for the fees.
 *         recoverer:
 *           type: address
 *           description: Address of a recoverer account, it can be a smart contract or a zero address. It can be used by some contracts to give specific roles to the caller and it's used during the Smart Wallet address generation.
 *         value:
 *           type: string
 *         nonce:
 *           type: string
 *         tokenAmount:
 *           type: string
 *           description: The amount of the fees paid to execute the transaction.
 *         tokenGas:
 *           type: string
 *           description: The amount of gas required to transfer the fees.
 *         index:
 *           type: string
 *           description: It allows the creation of many addresses for the same owner/recoverer.
 *         data:
 *           type: string
 *     RelayData:
 *       type: object
 *       properties:
 *         gasPrice:
 *           type: string
 *         domainSeparator:
 *           type: string
 *           description: Domain used when signing this request.
 *         relayWorker:
 *           type: address
 *           description: The address of the [relay worker](https://developers.rsk.co/rif/relay/architecture/#relay-worker).
 *         callForwarder:
 *           type: address
 *           description: The address of the smart contract that forwards the request (SmartWallet factory address for deploy transactions and SmartWallet address for relayed transactions).
 *         callVerifier:
 *           type: address
 *           description: The address of the contract entitled to verify the transaction. See [Relay and Deploy verifier](https://developers.rsk.co/rif/relay/architecture/#relay--deploy-verifier) for further details.
 *     RelayMetadata:
 *       type: object
 *       properties:
 *         relayHubAddress:
 *           type: address
 *           description: The address of the [relay hub](https://developers.rsk.co/rif/relay/architecture/#relay-hub).
 *         relayMaxNonce:
 *           type: number
 *         signature:
 *           type: string
 *           description: Transaction signature that will be used to verify the correctness of the transaction.
 */

const configureDocumentation = (app: express.Express, serverUrl: string) => {
    const swaggerDefinition = {
        openapi: '3.0.0',
        info: {
            title: 'RIF Relay Server API',
            version: '1.0.0',
            description:
                'This is a API application provided to support RIF Relay.',
            license: {
                name: 'Licensed Under MIT',
                url: 'https://spdx.org/licenses/MIT.html'
            },
            contact: {
                name: 'RSK Smart',
                url: 'https://developers.rsk.co/'
            }
        },
        servers: [
            {
                url: serverUrl
            }
        ]
    };

    const options = {
        swaggerDefinition,
        apis: ['./dist/*.js']
    };

    const swaggerSpec = swaggerJSDoc(options);
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
};

export default configureDocumentation;
