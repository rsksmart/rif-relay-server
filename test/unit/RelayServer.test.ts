import { RelayPricer } from '@rsksmart/rif-relay-client';
import {
    ContractInteractor,
    RelayMetadata,
    RelayTransactionRequest
} from '@rsksmart/rif-relay-common';
import { ForwardRequest, RelayData } from '@rsksmart/rif-relay-contracts';
import {
    ERC20Instance,
    IRelayHubInstance
} from '@rsksmart/rif-relay-contracts/types/truffle-contracts';
import BigNumber from 'bignumber.js';
import BN from 'bn.js';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
    createStubInstance,
    SinonStubbedInstance,
    stub,
    restore,
    replace,
    fake
} from 'sinon';
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
import * as gasEstimator from '../../src/GasEstimator';
import { INSUFFICIENT_TOKEN_AMOUNT } from '../../src/definitions/errorMessages.const';
import ExchangeToken from '../../src/definitions/token.type';

use(sinonChai);
use(chaiAsPromised);

describe('RelayServer', () => {
    let erc20Instance: SinonStubbedInstance<ERC20Instance>;

    let token: ExchangeToken;
    let fakeManagerKeyManager: SinonStubbedInstance<KeyManager> & KeyManager;
    let fakeWorkersKeyManager: SinonStubbedInstance<KeyManager> & KeyManager;
    let contractInteractor: SinonStubbedInstance<ContractInteractor> &
        ContractInteractor;
    let fakeTxStoreManager: SinonStubbedInstance<TxStoreManager> &
        TxStoreManager;
    let mockDependencies: ServerDependencies;

    beforeEach(() => {
        token = {
            instance: erc20Instance,
            name: 'tRif',
            symbol: 'RIF',
            decimals: 18
        };
        fakeManagerKeyManager = createStubInstance(KeyManager, {
            getAddress: stub()
        });
        fakeManagerKeyManager.getAddress.returns('fake_address');

        fakeWorkersKeyManager = createStubInstance(KeyManager, {
            getAddress: stub()
        });
        fakeWorkersKeyManager.getAddress.returns('fake_address');
        contractInteractor = createStubInstance(ContractInteractor, {
            getERC20Token: Promise.resolve(token)
        });
        contractInteractor.relayHubInstance = {
            address: 'relayHubAddress'
        } as IRelayHubInstance;

        fakeTxStoreManager = createStubInstance(TxStoreManager);

        mockDependencies = {
            managerKeyManager: fakeManagerKeyManager,
            workersKeyManager: fakeWorkersKeyManager,
            contractInteractor: contractInteractor,
            txStoreManager: fakeTxStoreManager
        };
    });

    afterEach(() => {
        restore();
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

        it('should set feesReceiver as collector contract if specified', () => {
            const config = {
                feesReceiver: '0x9957A338858bc941dA9D0ED2ACBCa4F16116B836'
            };

            const server = new RelayServer(config, mockDependencies);

            expect(
                server.feesReceiver,
                'Sets feesReceiver as collector contract'
            ).to.equal(config.feesReceiver);
        });

        it('should set feesReceiver as relay worker if not specified', () => {
            const server = new RelayServer({}, mockDependencies);

            expect(
                server.feesReceiver,
                'Sets feesReceiver as relay worker'
            ).to.equal('fake_address');
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

        beforeEach(() => {
            stub(RelayPricer.prototype, 'getExchangeRate').returns(
                Promise.resolve(xRateRifRbtc)
            );
        });

        const fakeMaxGasEstimation = (price?: number) =>
            contractInteractor.estimateRelayTransactionMaxPossibleGasWithTransactionRequest.returns(
                Promise.resolve(price ?? MAX_POSSIBLE_GAS.toNumber())
            ); // 3e7 gas is ethereum total block size gas limit)

        it('should call `toNativeWeiFrom` method with `tokenAmount` and exchange rate', async () => {
            const tokenAmount = new BigNumber(exampleTokenAmount.toString());
            const xRate = xRateRifRbtc;
            const expectedParams: ExchangeToken = {
                ...token,
                amount: tokenAmount,
                xRate
            };
            fakeMaxGasEstimation();
            const fakeToNativeWeiFrom = fake.returns(
                Promise.resolve(new BigNumber(tokenAmount.multipliedBy(xRate)))
            );
            replace(conversions, 'toNativeWeiFrom', fakeToNativeWeiFrom);

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

    describe('validateInput', () => {
        const fakeRelayHubAddress = 'fake_relay_hub_address';
        const fakeFeesReceiverAddress = 'fakeFeesReceiver';
        const fakeRelayTransactionRequest: RelayTransactionRequest = {
            relayRequest: {
                relayData: {
                    feesReceiver: fakeFeesReceiverAddress
                } as RelayData,
                request: {
                    to: 'fake_address',
                    data: 'fake_data'
                } as ForwardRequest
            },
            metadata: {
                relayHubAddress: fakeRelayHubAddress
            } as RelayMetadata
        };

        it('should throw error if feesReceiver on request is not the same as server', () => {
            const server = new RelayServer(
                {
                    feesReceiver: 'fake_different_relay_hub_address'
                },
                mockDependencies
            );
            server.relayHubContract = {
                address: fakeRelayHubAddress
            } as IRelayHubInstance;

            expect(() =>
                server.validateInput(fakeRelayTransactionRequest)
            ).to.throw(
                `Wrong fees receiver address: ${fakeFeesReceiverAddress}\n`
            );
        });
    });

    describe('estimateRelayTransaction', function () {
        const gasPrice = new BigNumber('60000000');
        const xRateRifRbtc = new BigNumber('0.00000332344907316948');
        const standardRelayEstimation = new BigNumber(99466);
        const relayTransactionRequest: RelayTransactionRequest = {
            relayRequest: {
                relayData: {
                    gasPrice: gasPrice.toString()
                } as RelayData,
                request: {} as ForwardRequest
            },
            metadata: {
                signature: '0x1'
            } as RelayMetadata
        };

        let server: RelayServer;
        beforeEach(function () {
            replace(
                gasEstimator,
                'estimateGasRelayTransaction',
                fake.returns(Promise.resolve(standardRelayEstimation))
            );
            replace(
                conversions,
                'getXRateFor',
                fake.returns(Promise.resolve(xRateRifRbtc))
            );
        });

        it('should estimate transaction with fee', async function () {
            const percentage = new BigNumber('0.1');
            server = new RelayServer(
                {
                    disableSponsoredTx: true,
                    feePercentage: percentage.toString()
                },
                mockDependencies
            );
            const { requiredTokenAmount } =
                await server.estimateRelayTransaction(relayTransactionRequest);
            const expectedRequiredTokenAmount = conversions
                .convertGasToToken(
                    standardRelayEstimation.plus(
                        percentage
                            .multipliedBy(standardRelayEstimation)
                            .toFixed(0)
                    ),
                    xRateRifRbtc,
                    gasPrice
                )
                .toFixed(0);

            expect(
                expectedRequiredTokenAmount == requiredTokenAmount,
                `${expectedRequiredTokenAmount.toString()} should equal ${requiredTokenAmount}`
            ).to.be.true;
        });

        it('should estimate transaction without fee', async function () {
            server = new RelayServer({}, mockDependencies);
            const { requiredTokenAmount } =
                await server.estimateRelayTransaction(relayTransactionRequest);
            const expectedRequiredTokenAmount = conversions
                .convertGasToToken(
                    standardRelayEstimation,
                    xRateRifRbtc,
                    gasPrice
                )
                .toFixed(0);

            expect(
                expectedRequiredTokenAmount == requiredTokenAmount,
                `${expectedRequiredTokenAmount.toString()} should equal ${requiredTokenAmount}`
            ).to.be.true;
        });
    });
});
