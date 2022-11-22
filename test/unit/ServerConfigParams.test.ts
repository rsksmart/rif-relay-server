/* import { use, expect } from 'chai';
import sinon from 'ts-sinon';
import {
    configureServer,
    ServerConfigParams,
    serverDefaultConfiguration,
    resolveServerConfig
} from '../../src';

import { constants, ContractInteractor } from '@rsksmart/rif-relay-common';
import promisedChai from 'chai-as-promised';
use(promisedChai);

describe('ServerConfigParams', () => {
    beforeEach(() => {
        sinon.restore();
    });

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

        it('should set feesReceiver to ZERO_ADDRESS if no feesReceiver specified', () => {
            const { feesReceiver: relayWorker } = configureServer({});

            expect(relayWorker, 'Is equal to given address').to.equal(
                constants.ZERO_ADDRESS
            );
        });

        it('should set feesReceiver to Collector Contract if specified as feesReceiver', () => {
            const expectedCollector: ServerConfigParams['feesReceiver'] =
                '0x9957A338858bc941dA9D0ED2ACBCa4F16116B836';
            const { feesReceiver: actualCollector } = configureServer({
                feesReceiver: expectedCollector
            });

            expect(actualCollector, 'Is equal to given address').to.equal(
                expectedCollector
            );
        });
    });

    describe('resolveServerConfig', () => {
        afterEach(function () {
            sinon.restore();
        });

        it('should fulfill if collectorContract is specified and is deployed', () => {
            sinon.mock(ContractInteractor);
            sinon
                .stub(ContractInteractor.prototype, 'isContractDeployed')
                .onFirstCall()
                .resolves(true)
                .onSecondCall()
                .resolves(true);

            const config = configureServer({
                url: 'https://dev.relay.rifcomputing.net:8090',
                port: 8090,
                relayHubAddress: '0x66Fa9FEAfB8Db66Fe2160ca7aEAc7FC24e254387',
                relayVerifierAddress:
                    '0x56ccdB6D312307Db7A4847c3Ea8Ce2449e9B79e9',
                deployVerifierAddress:
                    '0x5C6e96a84271AC19974C3e99d6c4bE4318BfE483',
                feesReceiver: '0x9957A338858bc941dA9D0ED2ACBCa4F16116B836',
                gasPriceFactor: 1,
                rskNodeUrl: 'http://172.17.0.1:4444',
                devMode: true,
                customReplenish: false,
                feePercentage: '0',
                logLevel: 1,
                workdir: '/srv/app/environment',
                versionRegistryAddress: null
            });

            return expect(resolveServerConfig(config, {})).to.eventually.be
                .fulfilled;
        });

        it('should reject if collectorContract is specified but it is not deployed', () => {
            sinon.mock(ContractInteractor);
            sinon
                .stub(ContractInteractor.prototype, 'isContractDeployed')
                .onFirstCall()
                .resolves(true)
                .onSecondCall()
                .resolves(false);

            const config = configureServer({
                url: 'https://dev.relay.rifcomputing.net:8090',
                port: 8090,
                relayHubAddress: '0x66Fa9FEAfB8Db66Fe2160ca7aEAc7FC24e254387',
                relayVerifierAddress:
                    '0x56ccdB6D312307Db7A4847c3Ea8Ce2449e9B79e9',
                deployVerifierAddress:
                    '0x5C6e96a84271AC19974C3e99d6c4bE4318BfE483',
                feesReceiver: '0x9957A338858bc941dA9D0ED2ACBCa4F16116B836',
                gasPriceFactor: 1,
                rskNodeUrl: 'http://172.17.0.1:4444',
                devMode: true,
                customReplenish: false,
                feePercentage: '0',
                logLevel: 1,
                workdir: '/srv/app/environment',
                versionRegistryAddress: null
            });

            return expect(resolveServerConfig(config, {})).to.be.rejectedWith(
                `FeesReceiver: no contract at address ${config.feesReceiver}`
            );
        });

        it('should return if collectorContract is the Relay Worker', () => {
            sinon.mock(ContractInteractor);
            sinon
                .stub(ContractInteractor.prototype, 'isContractDeployed')
                .onFirstCall()
                .resolves(true)
                .onSecondCall()
                .resolves(false);

            const config = configureServer({
                url: 'https://dev.relay.rifcomputing.net:8090',
                port: 8090,
                relayHubAddress: '0x66Fa9FEAfB8Db66Fe2160ca7aEAc7FC24e254387',
                relayVerifierAddress:
                    '0x56ccdB6D312307Db7A4847c3Ea8Ce2449e9B79e9',
                deployVerifierAddress:
                    '0x5C6e96a84271AC19974C3e99d6c4bE4318BfE483',
                gasPriceFactor: 1,
                rskNodeUrl: 'http://172.17.0.1:4444',
                devMode: true,
                customReplenish: false,
                feePercentage: '0',
                logLevel: 1,
                workdir: '/srv/app/environment',
                versionRegistryAddress: null
            });

            return expect(resolveServerConfig(config, {})).to.eventually.be
                .fulfilled;
        });
    });
});
 */
