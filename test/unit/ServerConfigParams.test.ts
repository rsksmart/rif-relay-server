import { expect } from 'chai';
import { configureServer, serverDefaultConfiguration } from '../../src';

describe('ServerConfigParams', () => {
  describe('configureServer', () => {
    it('should return default config if no overrides are given', () => {
      const expectedConfig = serverDefaultConfiguration;
      const actualConfig = configureServer({});

      expect(actualConfig).to.deep.equal(expectedConfig);
    });

    describe('sponsoredTxFee', () => {
      it('should be a equal to given value', () => {
        const expectedFee = '10000';
        const { sponsoredTxFee: actualFee } = configureServer({
          sponsoredTxFee: expectedFee,
        });

        expect(actualFee, 'Is a string').to.be.string;
        expect(actualFee, 'Is equal to given number').to.equal(expectedFee);
      });
    });
  });
});
