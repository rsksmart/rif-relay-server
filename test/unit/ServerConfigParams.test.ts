import { expect } from 'chai';
import {
    configureServer,
    ServerConfigParams,
    serverDefaultConfiguration
} from '../../src';

describe('ServerConfigParams', () => {
    describe('configureServer', () => {
        it('should return default config if no overrides are given', () => {
            const expectedConfig: ServerConfigParams =
                serverDefaultConfiguration;
            const actualConfig = configureServer({});

            expect(actualConfig).to.deep.equal(expectedConfig);
        });

        it('should set disableSponsoredTx', () => {
            const expectedValue: ServerConfigParams['disableSponsoredTx'] =
                true;
            const { disableSponsoredTx: actualValue } = configureServer({
                disableSponsoredTx: expectedValue
            });

            expect(actualValue, 'Is equal to given number').to.equal(
                expectedValue
            );
        });

        it('should set sponsoredTxFee', () => {
            const expectedFee: ServerConfigParams['feePercentage'] = '0.5';
            const { feePercentage: actualFee } = configureServer({
                feePercentage: expectedFee
            });

            expect(actualFee, 'Is equal to given number').to.equal(expectedFee);
        });
    });
});
