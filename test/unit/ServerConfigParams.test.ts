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

        describe('sponsoredTxFee', () => {
            it('should be a equal to given value', () => {
                const expectedFee: ServerConfigParams['feePercentage'] = '0.5';
                const { feePercentage: actualFee } = configureServer({
                    feePercentage: expectedFee
                });

                expect(actualFee, 'Is equal to given number').to.equal(
                    expectedFee
                );
            });
        });
    });
});
