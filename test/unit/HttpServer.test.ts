import {
  stub,
  spy,
  createStubInstance,
  SinonStubbedInstance,
  SinonSpy,
} from 'sinon';
import { use, expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import type { Request, Response } from 'express';
import {
  RelayServer,
  HttpServer,
  ServerConfigParams,
  RootHandlerRequest,
  WhitelistedRelayMethod,
  SignedTransactionDetails,
  RelayEstimation,
} from '../../src';
import jsonrpc from 'jsonrpc-lite';
import { BigNumber, utils } from 'ethers';

use(chaiAsPromised);

describe('HttpServer', function () {
  let gasPrice: BigNumber;
  let httpServer: HttpServer;
  let relayServer: SinonStubbedInstance<RelayServer>;

  beforeEach(function () {
    const expectedConfig: ServerConfigParams = {
      app: {
        url: 'http://localhost:8090',
      },
    } as ServerConfigParams;
    const port = 8095;
    gasPrice = BigNumber.from(5);
    relayServer = createStubInstance(RelayServer, {
      getMinGasPrice: gasPrice,
      validateMaxNonce: Promise.resolve(),
    });
    relayServer.config = expectedConfig;
    httpServer = new HttpServer(port, relayServer);
  });

  describe('processRootHandler', function () {
    it('should process method from relay server', async function () {
      const result = await httpServer.processRootHandler('getMinGasPrice', []);
      expect(result).to.be.equal(gasPrice);
    });

    it('should fail if method does not exist', async function () {
      const method = 'method' as WhitelistedRelayMethod;
      const error = new Error(
        `Implementation of method ${method} not available on backend!`
      );
      await expect(
        httpServer.processRootHandler(method, [])
      ).to.be.rejectedWith(error.message);
    });
  });

  describe('rootHandler', function () {
    let jsonrpcSpy: SinonSpy;
    let responseStub: SinonStubbedInstance<Response>;
    let requestStub: SinonStubbedInstance<Request>;
    let bodyRequest: RootHandlerRequest['body'];

    beforeEach(function () {
      responseStub = {
        send: stub(),
      } as typeof responseStub;
    });

    afterEach(function () {
      jsonrpcSpy.restore();
    });

    it('should fail if method does not exist', async function () {
      jsonrpcSpy = spy(jsonrpc, 'error');
      bodyRequest = {
        id: 1,
        method: 'method',
        params: [],
      };
      requestStub = {
        body: bodyRequest,
      } as typeof requestStub;
      await httpServer.rootHandler(requestStub, responseStub);
      expect(
        jsonrpcSpy.calledOnceWith(bodyRequest.id),
        'Responded with different id'
      ).to.be.true;
    });

    it('should fail if no id or method is provided in the request', async function () {
      jsonrpcSpy = spy(jsonrpc, 'error');
      requestStub = {} as typeof requestStub;
      await httpServer.rootHandler(requestStub, responseStub);
      expect(
        jsonrpcSpy.calledOnceWith(-1),
        'Responded with id different from -1'
      ).to.be.true;
    });

    it('should return a response with proper id and method result', async function () {
      jsonrpcSpy = spy(jsonrpc, 'success');
      bodyRequest = {
        id: 1,
        method: 'getMinGasPrice',
        params: [],
      };
      requestStub = {
        body: bodyRequest,
      } as typeof requestStub;
      await httpServer.rootHandler(requestStub, responseStub);
      expect(jsonrpcSpy.calledOnceWith(bodyRequest.id, gasPrice)).to.be.true;
    });

    it('should return a response with proper id and code 200 if method returns null', async function () {
      jsonrpcSpy = spy(jsonrpc, 'success');
      bodyRequest = {
        id: 1,
        method: 'validateMaxNonce',
        params: [],
      };
      requestStub = {
        body: bodyRequest,
      } as typeof requestStub;
      await httpServer.rootHandler(requestStub, responseStub);
      expect(jsonrpcSpy.calledOnceWith(bodyRequest.id, { code: 200 })).to.be
        .true;
    });
  });

  describe('relayHandler', function () {
    let responseStub: SinonStubbedInstance<Response>;
    let requestStub: SinonStubbedInstance<Request>;

    beforeEach(function () {
      responseStub = {
        send: stub(),
      } as typeof responseStub;
    });

    it('should return a reponse with signedTx and transactionHash in body', async function () {
      const fakeResponseRelayTransaction: SignedTransactionDetails = {
        signedTx:
          '0xf9036a1b8403e252e08301f9699466fa9feafb8db66fe2160ca7aeac7fc24e25438780b90304180e59260000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000028000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000003e252e0a81483953da7601ef828906dbab2e4baf21ddfd3d3c484fe7c43c55836c6c77200000000000000000000000074105590d404df3f384a099c2e55135281ca6b40000000000000000000000000eab5b9fa91aeffaa9c33f9b33d12ab7088fa7f6f0000000000000000000000005c6e96a84271ac19974c3e99d6c4be4318bfe48300000000000000000000000066fa9feafb8db66fe2160ca7aeac7fc24e254387000000000000000000000000cb8f8130e289946aec9a17b29819716b1e9e49980000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f5859303f76596dd558b438b18d0ce0e1660f3ea0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000411285a1fa3217b0b8ca9b23ee2404324c965af9bb3908199ffc8bc7a47f59cef9160a142da5269fa5b7bfa8a688c1a507bedeba0650f1d617b93c8ece598aba651c0000000000000000000000000000000000000000000000000000000000000062a053917eb36fd417620eb21f6fa35b701a9efa2dc4a39422c04e1469b21b1c0b63a010ff3e24bc8421bb801abb914c3f6031ecf99e7bb8d514eae77bbb7db8d1208c',
        txHash:
          '0xb8c646c863ff648b6f75f05cbcd84625521ca802d397e6473ba8f5e00e65f169',
      };

      relayServer.createRelayTransaction.resolves(fakeResponseRelayTransaction);
      requestStub = {
        body: {},
      } as typeof requestStub;

      await httpServer.relayHandler(requestStub, responseStub);

      expect(
        responseStub.send.calledOnceWithExactly(fakeResponseRelayTransaction)
      ).to.be.true;
    });
  });

  describe('estimateHandler', function () {
    const responseRelayEstimation: RelayEstimation = {
      estimation: '193889',
      exchangeRate: '0.00000332344907316948',
      gasPrice: '60000000',
      requiredTokenAmount: '3500381604736193689',
      requiredNativeAmount: '11633340000000',
    };
    let responseStub: SinonStubbedInstance<Response>;
    let requestStub: SinonStubbedInstance<Request>;

    beforeEach(function () {
      responseStub = {
        send: stub(),
      } as typeof responseStub;
      requestStub = {
        body: {},
      } as typeof requestStub;
    });

    it('should return response with RelayEstimation in body', async function () {
      relayServer.estimateMaxPossibleGas.resolves(responseRelayEstimation);
      await httpServer.estimateHandler(requestStub, responseStub);

      expect(responseStub.send.calledOnceWithExactly(responseRelayEstimation))
        .to.be.true;
    });
  });

  describe('tokenHandler', function () {
    const verifier = '0x145845fd06c85B7EA1AA2d030E1a747B3d8d15D7';
    const addressArray = ['0x145845fd06c85B7EA1AA2d030E1a747B3d8d15D7'];

    let responseStub: SinonStubbedInstance<Response>;
    let requestStub: SinonStubbedInstance<Request>;

    beforeEach(function () {
      responseStub = {
        send: stub(),
      } as typeof responseStub;
    });

    it('should return response with accepted tokens in body', async function () {
      const response = {
        [utils.getAddress(verifier)]: addressArray,
      };
      const handlerStub = relayServer.tokenHandler.resolves(response);

      requestStub = {
        query: { verifier },
      } as unknown as typeof requestStub;

      await httpServer.tokenHandler(requestStub, responseStub);

      expect(responseStub.send.calledOnceWithExactly(response)).to.be.true;
      expect(handlerStub).to.be.calledWith(verifier);
    });

    it('should return response with error in body', async function () {
      const message = 'Supplied verifier is not trusted';
      const handlerStub = relayServer.tokenHandler.throws(message);

      requestStub = {
        query: { verifier },
      } as unknown as typeof requestStub;

      await httpServer.tokenHandler(requestStub, responseStub);

      expect(responseStub.send.calledOnceWithExactly({ message })).to.be.true;
      expect(handlerStub).to.be.calledWith(verifier);
    });
  });

  describe('destinationContractHandler', function () {
    const verifier = '0x145845fd06c85B7EA1AA2d030E1a747B3d8d15D7';
    const addressArray = ['0x145845fd06c85B7EA1AA2d030E1a747B3d8d15D7'];

    let responseStub: SinonStubbedInstance<Response>;
    let requestStub: SinonStubbedInstance<Request>;

    beforeEach(function () {
      responseStub = {
        send: stub(),
      } as typeof responseStub;
    });

    it('should return response with accepted contracts in body', async function () {
      const response = {
        [utils.getAddress(verifier)]: addressArray,
      };
      const handlerStub =
        relayServer.destinationContractHandler.resolves(response);

      requestStub = {
        query: { verifier },
      } as unknown as typeof requestStub;

      await httpServer.destinationContractHandler(requestStub, responseStub);

      expect(responseStub.send.calledOnceWithExactly(response)).to.be.true;
      expect(handlerStub).to.be.calledWith(verifier);
    });

    it('should return response with error in body', async function () {
      const message = 'Supplied verifier is not trusted';
      const handlerStub =
        relayServer.destinationContractHandler.throws(message);

      requestStub = {
        query: { verifier },
      } as unknown as typeof requestStub;

      await httpServer.destinationContractHandler(requestStub, responseStub);

      expect(responseStub.send.calledOnceWithExactly({ message })).to.be.true;
      expect(handlerStub).to.be.calledWith(verifier);
    });
  });
});
