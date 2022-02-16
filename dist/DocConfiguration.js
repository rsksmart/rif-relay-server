"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const swagger_jsdoc_1 = __importDefault(require("swagger-jsdoc"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
/**
 * @swagger
 * components:
 *   schemas:
 *     PingResponse:
 *       type: object
 *       properties:
 *         relayWorkerAddress:
 *           type: string
 *           description: Relay Worker address.
 *         relayManagerAddress:
 *           type: string
 *           description: Relay Manager address.
 *         relayHubAddress:
 *           type: string
 *           description: Relay Hub address.
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
 *           type: string
 *         from:
 *           type: string
 *         to:
 *           type: string
 *         tokenContract:
 *           type: string
 *         value:
 *           type: string
 *         gas:
 *           type: string
 *         nonce:
 *           type: string
 *         tokenAmount:
 *           type: string
 *         tokenGas:
 *           type: string
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
 *           type: string
 *         from:
 *           type: string
 *         to:
 *           type: string
 *         tokenContract:
 *           type: string
 *         recoverer:
 *           type: string
 *         value:
 *           type: string
 *         nonce:
 *           type: string
 *         tokenAmount:
 *           type: string
 *         tokenGas:
 *           type: string
 *         index:
 *           type: string
 *         data:
 *           type: string
 *     RelayData:
 *       type: object
 *       properties:
 *         gasPrice:
 *           type: string
 *         domainSeparator:
 *           type: string
 *         relayWorker:
 *           type: string
 *         callForwarder:
 *           type: string
 *         callVerifier:
 *           type: string
 *     RelayMetadata:
 *       type: object
 *       properties:
 *         relayHubAddress:
 *           type: string
 *         relayMaxNonce:
 *           type: number
 *         signature:
 *           type: string
 */
const configureDocumentation = (app, serverUrl) => {
    const swaggerDefinition = {
        openapi: '3.0.0',
        info: {
            title: 'RIF Relay Server API',
            version: '1.0.0',
            description: 'This is a API application provided to support RIF Relay.',
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
                url: serverUrl,
            }
        ]
    };
    const options = {
        swaggerDefinition,
        apis: ['./dist/*.js']
    };
    const swaggerSpec = swagger_jsdoc_1.default(options);
    app.use('/docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swaggerSpec));
};
exports.default = configureDocumentation;
//# sourceMappingURL=DocConfiguration.js.map