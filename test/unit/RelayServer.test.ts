import { RelayPricer } from '@rsksmart/rif-relay-client';
import {
    ContractInteractor,
    RelayMetadata,
    RelayTransactionRequest
} from '@rsksmart/rif-relay-common';
import { ForwardRequest, RelayData } from '@rsksmart/rif-relay-contracts';
import BigNumber from 'bignumber.js';
import BN from 'bn.js';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import Sinon, { createStubInstance, SinonStubbedInstance, stub } from 'sinon';
import sinonChai from 'sinon-chai';
import { stubInterface } from 'ts-sinon';
import { toBN } from 'web3-utils';
import {
    KeyManager,
    RelayServer,
    ServerConfigParams,
    ServerDependencies,
    TxStoreManager
} from '../../src';
import * as conversions from '../../src/Conversions';
import { INSUFFICIENT_TOKEN_AMOUNT } from '../../src/definitions/errorMessages.const';
import ExchangeToken from '../../src/definitions/token.type';

use(sinonChai);
use(chaiAsPromised);

describe('RelayServer', () => {
    const token: ExchangeToken = {
        contractAddress: 'address',
        name: 'tRif',
        symbol: 'RIF',
        decimals: 18
    };
    let fakeManagerKeyManager: SinonStubbedInstance<KeyManager> & KeyManager;
    let fakeWorkersKeyManager: SinonStubbedInstance<KeyManager> & KeyManager;
    let fakeContractInteractor: SinonStubbedInstance<ContractInteractor> &
        ContractInteractor;
    let fakeTxStoreManager: SinonStubbedInstance<TxStoreManager> &
        TxStoreManager;
    let mockDependencies: ServerDependencies;

    beforeEach(() => {
        fakeManagerKeyManager = createStubInstance(KeyManager, {
            getAddress: stub()
        });
        fakeManagerKeyManager.getAddress.returns('fake_address');

        fakeWorkersKeyManager = createStubInstance(KeyManager, {
            getAddress: stub()
        });
        fakeWorkersKeyManager.getAddress.returns('fake_address');
        fakeContractInteractor = createStubInstance(ContractInteractor, {
            getERC20Token: Promise.resolve(token)
        });

        fakeTxStoreManager = createStubInstance(TxStoreManager);

        mockDependencies = {
            managerKeyManager: fakeManagerKeyManager,
            workersKeyManager: fakeWorkersKeyManager,
            contractInteractor: fakeContractInteractor,
            txStoreManager: fakeTxStoreManager
        };
    });

    afterEach(() => {
        Sinon.restore();
    });

    describe('constructor', () => {
        it('should call getAddress of key managers', () => {
            const server = new RelayServer(
                {
                    logLevel: 1
                },
                mockDependencies
            );

            expect(server, 'Is instance of RelayServer').to.be.instanceOf(
                RelayServer
            );

            expect(fakeManagerKeyManager.getAddress, 'Calls manager getAddress')
                .to.have.been.called;
            expect(fakeWorkersKeyManager.getAddress, 'Calls workers getAddress')
                .to.have.been.called;
        });
    });

    describe('getMaxPossibleGas', async () => {
        const fakeRelayTransactionRequest: RelayTransactionRequest = {
            relayRequest: {
                relayData: {
                    gasPrice: '1',
                    callForwarder: 'fake_address'
                } as RelayData,
                request: {
                    to: 'fake_address',
                    data: 'fake_data',
                    gas: '1'
                } as ForwardRequest
            },
            metadata: stubInterface<RelayMetadata>()
        };

        const exampleTokenAmount = toBN(10).pow(toBN(14));

        const MAX_POSSIBLE_GAS = new BigNumber(30_000_000);

        const xRateRifRbtc = BigNumber('0.00000332344907316948');

        const fakeMaxGasEstimation = (price?: number) =>
            fakeContractInteractor.estimateRelayTransactionMaxPossibleGasWithTransactionRequest.returns(
                Promise.resolve(price ?? MAX_POSSIBLE_GAS.toNumber())
            ); // 3e7 gas is ethereum total block size gas limit)

        it('should call `toNativeWeiFrom` method with `tokenAmount` and exchange rate', async () => {
            Sinon.stub(RelayPricer.prototype, 'getExchangeRate').returns(
                Promise.resolve(xRateRifRbtc)
            );
            const tokenAmount = new BigNumber(exampleTokenAmount.toString());
            const xRate = xRateRifRbtc;
            const expectedParams: ExchangeToken = {
                ...token,
                amount: tokenAmount,
                xRate
            };
            fakeMaxGasEstimation();
            const fakeToNativeWeiFrom = Sinon.fake.returns(
                Promise.resolve(new BigNumber(tokenAmount.multipliedBy(xRate)))
            );
            Sinon.replace(conversions, 'toNativeWeiFrom', fakeToNativeWeiFrom);

            const server = new RelayServer(
                {
                    disableSponsoredTx: true
                },
                mockDependencies
            );
            fakeRelayTransactionRequest.relayRequest.request.tokenAmount =
                exampleTokenAmount.toString();
            await server.getMaxPossibleGas(fakeRelayTransactionRequest, false);

            expect(
                fakeToNativeWeiFrom,
                'Called with'
            ).to.have.been.calledOnceWith(expectedParams);
        });

        it('should return estimated max gas as is, if disableSponsoredTx is false', async () => {
            const expectedGasEstimation = toBN(3);
            fakeMaxGasEstimation(expectedGasEstimation.toNumber());
            const server = new RelayServer({}, mockDependencies);

            fakeRelayTransactionRequest.relayRequest.request.tokenAmount =
                exampleTokenAmount.toString();

            const actualGasPrice = await server.getMaxPossibleGas(
                fakeRelayTransactionRequest,
                false
            );

            expect(
                actualGasPrice.eq(expectedGasEstimation),
                `${actualGasPrice} should equal ${expectedGasEstimation}`
            ).to.be.true;
        });

        it(`should throw \`${INSUFFICIENT_TOKEN_AMOUNT}\` if tokenAmount < gas + gas * fee`, async () => {
            fakeMaxGasEstimation(50);
            const payedTokens = '10';

            const server = new RelayServer(
                {
                    feePercentage: '0.25',
                    disableSponsoredTx: true
                },
                mockDependencies
            );
            fakeRelayTransactionRequest.relayRequest.request.tokenAmount =
                payedTokens;

            await expect(
                server.getMaxPossibleGas(fakeRelayTransactionRequest, false)
            ).to.eventually.have.rejectedWith(INSUFFICIENT_TOKEN_AMOUNT);
        });

        it(`should not throw \`${INSUFFICIENT_TOKEN_AMOUNT}\` if tokenAmount < gas + gas * fee, but disableSponsoredTx is false`, async () => {
            fakeMaxGasEstimation(50);
            const payedTokens = '10';

            const server = new RelayServer(
                {
                    feePercentage: '0.25'
                },
                mockDependencies
            );
            fakeRelayTransactionRequest.relayRequest.request.tokenAmount =
                payedTokens;

            await expect(
                server.getMaxPossibleGas(fakeRelayTransactionRequest, false)
            ).to.not.eventually.have.rejectedWith(INSUFFICIENT_TOKEN_AMOUNT);
        });

        it(`should not throw \`${INSUFFICIENT_TOKEN_AMOUNT}\` if tokenAmount >= gas + gas * fee`, async () => {
            const estimatedGas: BigNumber = conversions.toPrecision({
                value: 3,
                precision: 7
            }); // 3e7 gas is ethereum total block size gas limit
            fakeMaxGasEstimation(estimatedGas.toNumber());
            const feePercentage: ServerConfigParams['feePercentage'] = '0.05';

            const workerFee: BN = toBN(
                MAX_POSSIBLE_GAS.multipliedBy(feePercentage).toString()
            );
            const fakeGas: BN = toBN(estimatedGas.toString()).add(workerFee);

            const server = new RelayServer(
                {
                    feePercentage,
                    disableSponsoredTx: true
                },
                mockDependencies
            );
            fakeRelayTransactionRequest.relayRequest.request.tokenAmount =
                fakeGas.toString();

            await expect(
                server.getMaxPossibleGas(fakeRelayTransactionRequest, false)
            ).to.not.eventually.have.rejectedWith('INSUFFICIENT_TOKEN_AMOUNT');
        });

        it('should include fee in final max gas estimation', async () => {
            Sinon.stub(RelayPricer.prototype, 'getExchangeRate').returns(
                Promise.resolve(xRateRifRbtc)
            );
            fakeMaxGasEstimation();
            const feePercentage: ServerConfigParams['feePercentage'] =
                '10.0000001';

            const workerFee: BigNumber =
                MAX_POSSIBLE_GAS.multipliedBy(feePercentage);

            const expectedMaxGasEstimation: BigNumber =
                MAX_POSSIBLE_GAS.plus(workerFee);

            const server = new RelayServer(
                {
                    feePercentage,
                    disableSponsoredTx: true
                },
                mockDependencies
            );
            fakeRelayTransactionRequest.relayRequest.request.tokenAmount =
                expectedMaxGasEstimation.dividedBy(xRateRifRbtc).toString();
            const actualMaxGasEstimation = new BigNumber(
                (
                    await server.getMaxPossibleGas(
                        fakeRelayTransactionRequest,
                        false
                    )
                ).toString()
            );

            expect(actualMaxGasEstimation.isEqualTo(expectedMaxGasEstimation))
                .to.be.true;
        });
    });
});
