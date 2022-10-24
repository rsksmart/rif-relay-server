import { ContractInteractor, RelayMetadata, RelayTransactionRequest, DeployTransactionRequest } from '@rsksmart/rif-relay-common';
import { DeployRequest, DeployRequestStruct, ForwardRequest, RelayData, RelayRequest } from '@rsksmart/rif-relay-contracts';
import { IRelayHubInstance } from '@rsksmart/rif-relay-contracts/types/truffle-contracts';
import BigNumber from 'bignumber.js';
import { use, expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { SinonStubbedInstance, replace, replaceGetter, fake, restore, stub, createStubInstance } from 'sinon';
import * as gasEstimator from '../../src/GasEstimator';
import { estandardGasEstimation, estimateGasRelayTransaction } from '../../src/GasEstimator';

use(chaiAsPromised);

describe.only('GasEstimator', function () {
    const deployTransaction: Partial<DeployRequest> = {
        request: {
            index: '0'
        } as DeployRequestStruct,
        relayData: {
            gasPrice: '60000000'
        } as RelayData
    };
    const relayTransaction: Partial<RelayRequest> = {
        request: {
            gas: '100'
        } as ForwardRequest,
        relayData: {
            gasPrice: '60000000'
        } as RelayData
    };

    let contractInteractor: SinonStubbedInstance<ContractInteractor>;
    const tokenGas = new BigNumber(16559);
    const estandardDeployEstimation = new BigNumber(178869);
    const estandardRelayEstimation = new BigNumber(99466);
    const relayWorker = '0x0';

    describe('estimateRelayTransaction', function () {
        this.afterEach(function () {
            restore();
        });

        it('should estimate the relay transaction(estandard)', async function () {
            const relayEstandardEstimation = fake.returns(
                Promise.resolve(estandardRelayEstimation)
            );
            const metadata: Partial<RelayMetadata> = {
                signature: '0x1'
            };
            replace(gasEstimator, 'estandardGasEstimation', relayEstandardEstimation);
            const request: RelayTransactionRequest = {
                relayRequest: relayTransaction as RelayRequest,
                metadata: metadata as RelayMetadata
            };
            const estimation = await estimateGasRelayTransaction(contractInteractor, request, relayWorker);
            expect(estimation.eq(estandardRelayEstimation),
                `${estimation.toString()} should equal ${estandardRelayEstimation.toString()}`).to.be.true;
        });

        it('should estimate the deploy transaction(estandard)', async function () {
            const deployEstandardEstimation = fake.returns(
                Promise.resolve(estandardDeployEstimation)
            );
            const metadata: Partial<RelayMetadata> = {
                signature: '0x1'
            };
            replace(gasEstimator, 'estandardGasEstimation', deployEstandardEstimation);
            const request: DeployTransactionRequest = {
                relayRequest: deployTransaction as DeployRequest,
                metadata: metadata as RelayMetadata
            };
            const estimation = await estimateGasRelayTransaction(contractInteractor, request, relayWorker);
            expect(estimation.eq(estandardDeployEstimation),
                `${estimation.toString()} should equal ${estandardDeployEstimation.toString()}`).to.be.true;
        });

    });

    describe.only('estandardGasEstimation', function () {
        const deployGas = 147246;
        const relayGas = 82907;
        let relayHubInstance: Partial<IRelayHubInstance>;
        const metadata: Partial<RelayMetadata> = {
            signature: '0x1'
        };

        const estimateGasTokenTransfer = fake.returns(
            Promise.resolve(tokenGas)
        );

        beforeEach(function () {
            replace(gasEstimator, 'estimateGasTokenTransfer', estimateGasTokenTransfer);
            relayHubInstance = {
                contract: {
                    methods: {
                        relayCall: fake.returns({ estimateGas: () => relayGas }),
                        deployCall: fake.returns({ estimateGas: () => deployGas })
                    }
                }
            };
            contractInteractor = createStubInstance(ContractInteractor);
            replaceGetter(contractInteractor, 'relayHubInstance', function () {
                return relayHubInstance as IRelayHubInstance;
            });
        });

        it('should estimate the relay transaction ', async function () {
            const request: RelayTransactionRequest = {
                relayRequest: relayTransaction as RelayRequest,
                metadata: metadata as RelayMetadata
            };
            const estimation = await estandardGasEstimation(contractInteractor, request, relayWorker, tokenGas);
            const relayEstimation = tokenGas.plus(gasEstimator.applyGasCorrectionFactor(relayGas));
            expect(estimation.eq(estimation),
                `${estimation.toString()} should equal ${relayEstimation.toString()}`).to.be.true;
        });





    });

})