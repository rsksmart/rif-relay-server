import { expect } from 'chai';
import { providers } from 'ethers';
import { SinonStub, stub } from 'sinon';
import {
  clientErrorMessage,
  RedactingJsonRpcProvider,
  redactUrl,
  redactUrlIn,
} from '../../src/Utils';

describe('Utils', function () {
  describe('redactUrl', function () {
    it('should keep a URL without credentials as it is', function () {
      expect(redactUrl('http://127.0.0.1:4444')).to.equal(
        'http://127.0.0.1:4444'
      );
      expect(redactUrl('https://public-node.rsk.co/')).to.equal(
        'https://public-node.rsk.co'
      );
    });

    it('should hide an API key in the path', function () {
      expect(redactUrl('https://rpc.testnet.rootstock.io/SECRET')).to.equal(
        'https://rpc.testnet.rootstock.io/***'
      );
    });

    it('should hide an API key in the query', function () {
      expect(redactUrl('https://node.example.com/?apikey=SECRET')).to.equal(
        'https://node.example.com/***'
      );
    });

    it('should hide the user info', function () {
      expect(redactUrl('https://user:SECRET@node.example.com:8545')).to.equal(
        'https://node.example.com:8545'
      );
    });

    it('should hide a value that is not a URL', function () {
      expect(redactUrl('SECRET')).to.equal('***');
    });
  });

  describe('redactUrlIn', function () {
    const url = 'https://rpc.example.com/SECRET';

    it('should redact the URL wherever it appears in a text', function () {
      expect(
        redactUrlIn(
          'missing response (url="https://rpc.example.com/SECRET"), then https://rpc.example.com/SECRET failed',
          url
        )
      ).to.equal(
        'missing response (url="https://rpc.example.com/***"), then https://rpc.example.com/*** failed'
      );
    });

    it('should leave a text without the URL as it is', function () {
      expect(redactUrlIn('Invalid verifier', url)).to.equal('Invalid verifier');
    });

    it('should redact an error with the URL in its message, stack and properties without modifying it', function () {
      const error = Object.assign(
        new Error('bad response (url="https://rpc.example.com/SECRET")'),
        { url, status: 429 }
      );

      const redacted = redactUrlIn(error, url) as Error & {
        url: string;
        status: number;
      };

      expect(redacted).to.be.instanceOf(Error);
      expect(redacted.message).to.equal(
        'bad response (url="https://rpc.example.com/***")'
      );
      expect(redacted.stack).to.include('https://rpc.example.com/***');
      expect(redacted.stack).not.to.include('SECRET');
      expect(redacted.url).to.equal('https://rpc.example.com/***');
      expect(redacted.status).to.equal(429);
      expect(error.message).to.include('SECRET');
      expect(error.url).to.include('SECRET');
    });

    it('should redact strings nested in arrays and plain objects and keep other values', function () {
      const value = {
        urls: [url],
        nested: { note: `at ${url}` },
        count: 3,
      };

      expect(redactUrlIn(value, url)).to.deep.equal({
        urls: ['https://rpc.example.com/***'],
        nested: { note: 'at https://rpc.example.com/***' },
        count: 3,
      });
      expect(value.urls[0]).to.include('SECRET');
    });
  });

  describe('RedactingJsonRpcProvider', function () {
    const url = 'https://rpc.example.com/SECRET';
    const network = { name: 'test', chainId: 33 };
    let send: SinonStub;

    beforeEach(function () {
      send = stub(providers.JsonRpcProvider.prototype, 'send');
    });

    afterEach(function () {
      send.restore();
    });

    it('should return the result of a successful call', async function () {
      send.resolves('0x10');
      const provider = new RedactingJsonRpcProvider(url, network);

      expect(await provider.send('eth_blockNumber', [])).to.equal('0x10');
      expect(send.calledOnceWithExactly('eth_blockNumber', [])).to.be.true;
    });

    it('should reject a failed call with the URL redacted from the error', async function () {
      send.rejects(
        Object.assign(
          new Error(`missing response (url="${url}", code=SERVER_ERROR)`),
          { code: 'SERVER_ERROR', reason: 'missing response', url }
        )
      );
      const provider = new RedactingJsonRpcProvider(url, network);

      const rejection = (await provider.send('eth_blockNumber', []).then(
        () => expect.fail('the call should have been rejected'),
        (e: unknown) => e
      )) as Error & { code: string; url: string };

      expect(rejection).to.be.instanceOf(Error);
      expect(rejection.message).to.equal(
        'missing response (url="https://rpc.example.com/***", code=SERVER_ERROR)'
      );
      expect(rejection.url).to.equal('https://rpc.example.com/***');
      expect(rejection.code).to.equal('SERVER_ERROR');
    });
  });

  describe('clientErrorMessage', function () {
    it('should reduce an ethers error to its reason and code', function () {
      const error = Object.assign(
        new Error(
          'cannot estimate gas; transaction may fail or may require manual gas limit (reason="execution reverted", method="estimateGas", transaction={"from":"0x1"}, error={"url":"https://rpc.example.com/SECRET"}, code=UNPREDICTABLE_GAS_LIMIT, version=providers/5.8.0)'
        ),
        { code: 'UNPREDICTABLE_GAS_LIMIT', reason: 'execution reverted' }
      );

      expect(clientErrorMessage(error)).to.equal(
        'execution reverted (UNPREDICTABLE_GAS_LIMIT)'
      );
    });

    it("should include the node's error nested in a server error", function () {
      const error = Object.assign(
        new Error(
          'processing response error (body="{...}", error={"code":-32010}, requestBody="{...}", url="https://rpc.example.com/SECRET", code=SERVER_ERROR, version=web/5.8.0)'
        ),
        {
          code: 'SERVER_ERROR',
          reason: 'processing response error',
          error: Object.assign(
            new Error(
              'VM Exception while processing transaction: revert Not enough tokens'
            ),
            { code: -32010 }
          ),
        }
      );

      expect(clientErrorMessage(error)).to.equal(
        'processing response error: VM Exception while processing transaction: revert Not enough tokens (SERVER_ERROR)'
      );
    });

    it('should not repeat an ethers error nested in another one', function () {
      const error = Object.assign(new Error('cannot estimate gas; ...'), {
        code: 'UNPREDICTABLE_GAS_LIMIT',
        reason: 'VM Exception while processing transaction: revert',
        error: Object.assign(new Error('processing response error (...)'), {
          code: 'SERVER_ERROR',
          reason: 'processing response error',
        }),
      });

      expect(clientErrorMessage(error)).to.equal(
        'VM Exception while processing transaction: revert (UNPREDICTABLE_GAS_LIMIT)'
      );
    });

    it('should report an ethers error without a reason by its code', function () {
      const error = Object.assign(new Error('call revert exception'), {
        code: 'CALL_EXCEPTION',
        reason: null,
      });

      expect(clientErrorMessage(error)).to.equal('CALL_EXCEPTION');
    });

    it('should report any other error by its message', function () {
      expect(clientErrorMessage(new Error('Invalid verifier'))).to.equal(
        'Invalid verifier'
      );
    });

    it('should describe a value that is not an error', function () {
      expect(clientErrorMessage('boom')).to.equal('boom');
    });
  });
});
