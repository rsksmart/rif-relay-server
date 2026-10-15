import { expect } from 'chai';
import { redactUrl } from '../../src/Utils';

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
});
