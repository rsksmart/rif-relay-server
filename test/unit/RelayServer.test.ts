import { RelayPricer } from '@rsksmart/rif-relay-client';
import {
    ContractInteractor,
    RelayMetadata,
    RelayTransactionRequest
} from '@rsksmart/rif-relay-common';
import {
    DeployRequest,
    ForwardRequest,
    RelayData,
    RelayRequest
} from '@rsksmart/rif-relay-contracts';
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
    let fakeManagerKeyManager: SinonStubbedInstance<KeyManager> & KeyManager;
    let fakeWorkersKeyManager: SinonStubbedInstance<KeyManager> & KeyManager;
    let contractInteractor: SinonStubbedInstance<ContractInteractor> &
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
        contractInteractor = createStubInstance(ContractInteractor);
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
        const token: ExchangeToken = {
            instance: {} as ERC20Instance,
            name: 'tRif',
            symbol: 'RIF',
            decimals: 18
        };
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
            contractInteractor.getERC20Token.returns(Promise.resolve(token));
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
                'estimateRelayMaxPossibleGas',
                fake.returns(Promise.resolve(standardRelayEstimation))
            );
            replace(
                conversions,
                'getXRateFor',
                fake.returns(Promise.resolve(xRateRifRbtc))
            );
        });

        it('should estimate transaction with fee', async function () {
            const token: ExchangeToken = {
                instance: {} as ERC20Instance,
                name: 'tRif',
                symbol: 'RIF',
                decimals: 18
            };
            const percentage = new BigNumber('0.1');
            server = new RelayServer(
                {
                    disableSponsoredTx: true,
                    feePercentage: percentage.toString()
                },
                mockDependencies
            );
            const { requiredTokenAmount } = await server.estimateMaxPossibleGas(
                relayTransactionRequest
            );
            const expectedRequiredTokenAmount = conversions
                .convertGasToToken(
                    standardRelayEstimation.plus(
                        percentage
                            .multipliedBy(standardRelayEstimation)
                            .toFixed(0)
                    ),
                    { ...token, xRate: xRateRifRbtc },
                    gasPrice
                )
                .toFixed(0);

            expect(
                expectedRequiredTokenAmount == requiredTokenAmount,
                `${expectedRequiredTokenAmount.toString()} should equal ${requiredTokenAmount}`
            ).to.be.true;
        });

        it('should estimate transaction without fee', async function () {
            const token: ExchangeToken = {
                instance: {} as ERC20Instance,
                name: 'tRif',
                symbol: 'RIF',
                decimals: 18
            };
            server = new RelayServer({}, mockDependencies);
            const { requiredTokenAmount } = await server.estimateMaxPossibleGas(
                relayTransactionRequest
            );
            const expectedRequiredTokenAmount = conversions
                .convertGasToToken(
                    standardRelayEstimation,
                    { ...token, xRate: xRateRifRbtc },
                    gasPrice
                )
                .toFixed(0);

            expect(
                expectedRequiredTokenAmount == requiredTokenAmount,
                `${expectedRequiredTokenAmount.toString()} should equal ${requiredTokenAmount}`
            ).to.be.true;
        });
    });

    describe('isSponsorshipAllowed', function () {
        const relayRequest: RelayRequest = {
            request: {
                to: ''
            }
        } as RelayRequest;
        const deployRequest: DeployRequest = {
            request: {
                to: ''
            }
        } as DeployRequest;

        describe('disabledSponsoredTx(true)', function () {
            let server: RelayServer;

            describe('', function () {
                beforeEach(function () {
                    server = new RelayServer(
                        {
                            disableSponsoredTx: true,
                            sponsoredDestinations: ['0x1']
                        },
                        mockDependencies
                    );
                });

                it('should not sponsor relay transactions if the destination contract address is not among the sponsored ones', function () {
                    relayRequest.request.to = '0x2';
                    expect(
                        server.isSponsorshipAllowed(relayRequest),
                        'Tx is sponsored'
                    ).to.be.false;
                });

                it('should not sponsor deploy transactions if the destination contract address is not among the sponsored ones', function () {
                    deployRequest.request.to = '0x2';
                    expect(
                        server.isSponsorshipAllowed(deployRequest),
                        'Tx is sponsored'
                    ).to.be.false;
                });

                it('should sponsor relay transactions if the destination contract address is among the sponsored ones', function () {
                    relayRequest.request.to = '0x1';
                    expect(
                        server.isSponsorshipAllowed(relayRequest),
                        'Tx is not sponsored'
                    ).to.be.true;
                });

                it('should sponsor deploy transactions if the destination contract address is among the sponsored ones', function () {
                    deployRequest.request.to = '0x1';
                    expect(
                        server.isSponsorshipAllowed(deployRequest),
                        'Tx is not sponsored'
                    ).to.be.true;
                });
            });

            it('should not sponsor transactions if sponsoredDestinations its undefined', function () {
                deployRequest.request.to = '0x1';
                server = new RelayServer(
                    {
                        disableSponsoredTx: true
                    },
                    mockDependencies
                );
                expect(
                    server.isSponsorshipAllowed(deployRequest),
                    'Tx is sponsored'
                ).to.be.false;
            });

            it('should not sponsor transactions if sponsoredDestinations its empty', function () {
                deployRequest.request.to = '0x1';
                server = new RelayServer(
                    {
                        disableSponsoredTx: true,
                        sponsoredDestinations: []
                    },
                    mockDependencies
                );
                expect(
                    server.isSponsorshipAllowed(deployRequest),
                    'Tx is sponsored'
                ).to.be.false;
            });

            it('should sponsor transactions if the destination contract address is among the sponsored ones(multiple addresses)', function () {
                relayRequest.request.to = '0x1';
                deployRequest.request.to = '0x2';
                server = new RelayServer(
                    {
                        disableSponsoredTx: true,
                        sponsoredDestinations: ['0x1', '0x2']
                    },
                    mockDependencies
                );
                expect(
                    server.isSponsorshipAllowed(deployRequest),
                    'Tx is not sponsored'
                ).to.be.true;
                expect(
                    server.isSponsorshipAllowed(relayRequest),
                    'Tx is not sponsored'
                ).to.be.true;
            });
        });

        describe('disabledSponsoredTx(false)', function () {
            let server: RelayServer;
            beforeEach(function () {
                server = new RelayServer(
                    { disableSponsoredTx: false },
                    mockDependencies
                );
            });

            it('should sponsor relay transaction', function () {
                relayRequest.request.to = '0x1';
                expect(
                    server.isSponsorshipAllowed(relayRequest),
                    'Tx is not sponsored'
                ).to.be.true;
            });

            it('should sponsor deploy transaction', function () {
                deployRequest.request.to = '0x1';
                expect(
                    server.isSponsorshipAllowed(deployRequest),
                    'Tx is not sponsored'
                ).to.be.true;
            });
        });
    });
});
