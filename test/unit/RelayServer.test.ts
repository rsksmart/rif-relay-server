import { KeyManager, RelayServer, TxStoreManager } from '../../src';
import sinon, { mock, createStubInstance } from 'sinon';
import type {
  //   DeployTransactionRequest,
  EnvelopingTxRequest,
} from '@rsksmart/rif-relay-client';
import * as rifClient from '@rsksmart/rif-relay-client';
import { BigNumber, constants, providers } from 'ethers';
import * as utils from '../../src/Utils';
import { ERC20__factory, ERC20 } from '@rsksmart/rif-relay-contracts';
import { expect } from 'chai';
import * as Conversions from '../../src/Conversions';
import { BigNumber as BigNumberJs } from 'bignumber.js';

describe('RelayServer tests', function () {
  let relayServer: RelayServer;
  const fakeEstimationBeforeFees = 100000;

  beforeEach(function () {
    const managerKeyManager = createStubInstance(KeyManager);
    const workersKeyManager = createStubInstance(KeyManager);
    const txStoreManager = createStubInstance(TxStoreManager);

    relayServer = new RelayServer({
      managerKeyManager,
      txStoreManager,
      workersKeyManager,
    });
  });

  afterEach(function () {
    sinon.restore();
  });

  describe('Function estimateMaxPossibleGas()', function () {
    it('...when is sponsored', async function () {
      const tokenXRate = '0.5';
      const mockServer = mock(relayServer);

      sinon.replaceGetter(rifClient, 'estimateRelayMaxPossibleGas', () =>
        sinon.stub().resolves(BigNumber.from(fakeEstimationBeforeFees))
      );
      sinon.stub(utils, 'getProvider').returns(providers.getDefaultProvider());

      mockServer.expects('isSponsorshipAllowed').returns(true);

      const token = {
        name: () => Promise.resolve('TestToken'),
        symbol: () => Promise.resolve('TT'),
        decimals: () => Promise.resolve(18),
      } as unknown as ERC20;
      sinon.stub(ERC20__factory, 'connect').returns(token);

      sinon.stub(Conversions, 'getXRateFor').resolves(tokenXRate);

      const maxPossibleGaseEstimation =
        await relayServer.estimateMaxPossibleGas({
          relayRequest: {
            request: {
              tokenContract: constants.AddressZero,
            },
            relayData: {
              gasPrice: 1000,
            },
          },
        } as EnvelopingTxRequest);

      expect(maxPossibleGaseEstimation.estimation).to.be.eq(
        fakeEstimationBeforeFees.toString()
      );
    });

    it('...when is not sponsored and transferFeePercentage = 0', async function () {
      const tokenXRate = '0.5';
      const mockServer = mock(relayServer);
      const fakeFeePercentage = 0.1;

      const fakeServerConfigParams = {
        app: {
          feePercentage: fakeFeePercentage,
        },
      };

      sinon.replaceGetter(rifClient, 'estimateRelayMaxPossibleGas', () =>
        sinon.stub().resolves(BigNumber.from(fakeEstimationBeforeFees))
      );

      mockServer.expects('isSponsorshipAllowed').returns(false);

      sinon.stub(relayServer, 'config').value(fakeServerConfigParams);

      sinon.stub(utils, 'getProvider').returns(providers.getDefaultProvider());

      const token = {
        name: () => Promise.resolve('TestToken'),
        symbol: () => Promise.resolve('TT'),
        decimals: () => Promise.resolve(18),
      } as unknown as ERC20;
      sinon.stub(ERC20__factory, 'connect').returns(token);

      sinon.stub(Conversions, 'getXRateFor').resolves(tokenXRate);

      const maxPossibleGaseEstimation =
        await relayServer.estimateMaxPossibleGas({
          relayRequest: {
            request: {
              tokenContract: constants.AddressZero,
            },
            relayData: {
              gasPrice: 1000,
            },
          },
        } as EnvelopingTxRequest);

      expect(maxPossibleGaseEstimation.estimation).to.be.eq(
        (
          fakeEstimationBeforeFees +
          fakeEstimationBeforeFees * fakeFeePercentage
        ).toString()
      );
    });

    it('...when is not sponsored, transfer and transferFeePercentage > 0', async function () {
      const tokenXRate = '0.5';
      const mockServer = mock(relayServer);
      const fakeFeePercentage = 0.1;
      const fakeTransferFeePercentage = 0.1;
      const tokenAmountToTransfer = 1000;

      const fakeServerConfigParams = {
        app: {
          feePercentage: fakeFeePercentage,
          transferFeePercentage: fakeTransferFeePercentage,
        },
      };

      sinon.replaceGetter(rifClient, 'estimateRelayMaxPossibleGas', () =>
        sinon.stub().resolves(BigNumber.from(fakeEstimationBeforeFees))
      );

      mockServer.expects('isSponsorshipAllowed').returns(false);

      sinon.stub(relayServer, 'config').value(fakeServerConfigParams);

      sinon.stub(utils, 'getProvider').returns(providers.getDefaultProvider());

      const token = {
        name: () => Promise.resolve('TestToken'),
        symbol: () => Promise.resolve('TT'),
        decimals: () => Promise.resolve(18),
      } as unknown as ERC20;
      sinon.stub(ERC20__factory, 'connect').returns(token);

      sinon.stub(Conversions, 'getXRateFor').resolves(tokenXRate);

      const maxPossibleGaseEstimation =
        await relayServer.estimateMaxPossibleGas({
          relayRequest: {
            request: {
              tokenContract: constants.AddressZero,
              data: '0xa9059cbb0000000000000000000000008470af7f41ee2788eaa4cfc251927877b659cdc500000000000000000000000000000000000000000000000000000000000003e8',
            },
            relayData: {
              gasPrice: 1000,
            },
          },
        } as EnvelopingTxRequest);

      console.log(
        'test168 maxPossibleGaseEstimation: ',
        maxPossibleGaseEstimation
      );

      expect(maxPossibleGaseEstimation.estimation).to.be.eq(
        (
          fakeEstimationBeforeFees +
          tokenAmountToTransfer * (fakeTransferFeePercentage)
        ).toString()
      );
    });

    it('...when is not sponsored, transferFrom and transferFeePercentage > 0', async function () {
      const tokenXRate = '0.5';
      const mockServer = mock(relayServer);
      const fakeFeePercentage = 0.1;
      const fakeTransferFeePercentage = 0.1;
      const tokenAmountToTransfer = 1000;

      const fakeServerConfigParams = {
        app: {
          feePercentage: fakeFeePercentage,
          transferFeePercentage: fakeTransferFeePercentage,
        },
      };

      sinon.replaceGetter(rifClient, 'estimateRelayMaxPossibleGas', () =>
        sinon.stub().resolves(BigNumber.from(fakeEstimationBeforeFees))
      );

      mockServer.expects('isSponsorshipAllowed').returns(false);

      sinon.stub(relayServer, 'config').value(fakeServerConfigParams);

      sinon.stub(utils, 'getProvider').returns(providers.getDefaultProvider());

      const token = {
        name: () => Promise.resolve('TestToken'),
        symbol: () => Promise.resolve('TT'),
        decimals: () => Promise.resolve(18),
      } as unknown as ERC20;
      sinon.stub(ERC20__factory, 'connect').returns(token);

      sinon.stub(Conversions, 'getXRateFor').resolves(tokenXRate);

      const maxPossibleGaseEstimation =
        await relayServer.estimateMaxPossibleGas({
          relayRequest: {
            request: {
              tokenContract: constants.AddressZero,
              data: '0x23b872dd000000000000000000000000e87286ba960fa7aaa5b376083a31d440c8cb4bc80000000000000000000000008470af7f41ee2788eaa4cfc251927877b659cdc500000000000000000000000000000000000000000000000000000000000003e8',
            },
            relayData: {
              gasPrice: 1000,
            },
          },
        } as EnvelopingTxRequest);

      console.log(
        'test168 maxPossibleGaseEstimation: ',
        maxPossibleGaseEstimation
      );

      expect(maxPossibleGaseEstimation.estimation).to.be.eq(
        (
          fakeEstimationBeforeFees +
          tokenAmountToTransfer * (fakeTransferFeePercentage)
        ).toString()
      );
    });
  });

  describe('Function getMaxPossibleGas()', function () {
    it('...when is sponsored', async function () {
      const mockServer = mock(relayServer);
      //   sinon.replaceGetter(rifClient, 'isDeployTransaction', () =>
      //         sinon.stub().resolves({} as DeployTransactionRequest)
      //   );

      sinon.stub(utils, 'getProvider').returns(providers.getDefaultProvider());
      mockServer.expects('_validateIfGasAmountIsEnough').resolves();
      sinon.replaceGetter(rifClient, 'standardMaxPossibleGasEstimation', () =>
        sinon.stub().resolves(BigNumber.from(fakeEstimationBeforeFees))
      );
      mockServer.expects('isSponsorshipAllowed').returns(true);

      const maxPossibleGas = await relayServer.getMaxPossibleGas({
        relayRequest: {
          request: {
            tokenContract: constants.AddressZero,
            tokenGas: 200000,
          },
          relayData: {
            gasPrice: 1000,
          },
        },
      } as EnvelopingTxRequest);

      expect(maxPossibleGas.toString()).to.be.equal(
        fakeEstimationBeforeFees.toString()
      );
    });

    it('...not sponsored and transferFeePercentage = 0', async function () {
      const fakeFeePercentage = 0.1;
      const tokenXRate = '0.5';
      const tokenAmount = '2'+'0'.repeat(18);
      const fakeServerConfigParams = {
        app: {
          feePercentage: fakeFeePercentage,
        },
      };
      const mockServer = mock(relayServer);
      //   sinon.replaceGetter(rifClient, 'isDeployTransaction', () =>
      //         sinon.stub().resolves({} as DeployTransactionRequest)
      //   );

      sinon.stub(utils, 'getProvider').returns(providers.getDefaultProvider());
      mockServer.expects('_validateIfGasAmountIsEnough').resolves();
      sinon.replaceGetter(rifClient, 'standardMaxPossibleGasEstimation', () =>
        sinon.stub().resolves(BigNumber.from(fakeEstimationBeforeFees))
      );
      mockServer.expects('isSponsorshipAllowed').returns(false);
      sinon.stub(relayServer, 'config').value(fakeServerConfigParams);
      const token = {
        name: () => Promise.resolve('TestToken'),
        symbol: () => Promise.resolve('TT'),
        decimals: () => Promise.resolve(18),
      } as unknown as ERC20;
      sinon.stub(ERC20__factory, 'connect').returns(token);

      sinon.stub(Conversions, 'getXRateFor').resolves(tokenXRate);

      const maxPossibleGas = await relayServer.getMaxPossibleGas({
        relayRequest: {
          request: {
            tokenContract: constants.AddressZero,
            tokenGas: 200000,
            tokenAmount: tokenAmount,
          },
          relayData: {
            gasPrice: 1000,
          },
        },
      } as EnvelopingTxRequest);

      expect(maxPossibleGas.toString()).to.be.equal(
        BigNumberJs(fakeEstimationBeforeFees).multipliedBy(1+fakeFeePercentage).toString()    
      );
    });
    it('...not sponsored, transferFeePercentage > 0 and transfer', async function () {
      const fakeFeePercentage = 0.1;
      const fakeTransferFeePercentage = 0.1;
      const tokenXRate = '0.5';
      const tokenAmount = '2'+'0'.repeat(18);
      const valueToTransfer = 1000;
      const fakeServerConfigParams = {
        app: {
          feePercentage: fakeFeePercentage,
          transferFeePercentage: fakeTransferFeePercentage
        },
      };
      const mockServer = mock(relayServer);
      //   sinon.replaceGetter(rifClient, 'isDeployTransaction', () =>
      //         sinon.stub().resolves({} as DeployTransactionRequest)
      //   );

      sinon.stub(utils, 'getProvider').returns(providers.getDefaultProvider());
      mockServer.expects('_validateIfGasAmountIsEnough').resolves();
      sinon.replaceGetter(rifClient, 'standardMaxPossibleGasEstimation', () =>
        sinon.stub().resolves(BigNumber.from(fakeEstimationBeforeFees))
      );
      mockServer.expects('isSponsorshipAllowed').returns(false);
      sinon.stub(relayServer, 'config').value(fakeServerConfigParams);
      const token = {
        name: () => Promise.resolve('TestToken'),
        symbol: () => Promise.resolve('TT'),
        decimals: () => Promise.resolve(18),
      } as unknown as ERC20;
      sinon.stub(ERC20__factory, 'connect').returns(token);

      sinon.stub(Conversions, 'getXRateFor').resolves(tokenXRate);

      const maxPossibleGas = await relayServer.getMaxPossibleGas({
        relayRequest: {
          request: {
            tokenContract: constants.AddressZero,
            tokenGas: 200000,
            tokenAmount: tokenAmount,
            data: '0xa9059cbb0000000000000000000000008470af7f41ee2788eaa4cfc251927877b659cdc500000000000000000000000000000000000000000000000000000000000003e8'
          },
          relayData: {
            gasPrice: 1000,
          },
        },
      } as EnvelopingTxRequest);

      expect(maxPossibleGas.toString()).to.be.equal(
        (fakeEstimationBeforeFees + (valueToTransfer * fakeTransferFeePercentage)).toString()
      );
    });
    it('...not sponsored, transferFeePercentage > 0 and transferFrom', async function () {
      const fakeFeePercentage = 0.1;
      const fakeTransferFeePercentage = 0.1;
      const tokenXRate = '0.5';
      const tokenAmount = '2'+'0'.repeat(18);
      const valueToTransfer = 1000;
      const fakeServerConfigParams = {
        app: {
          feePercentage: fakeFeePercentage,
          transferFeePercentage: fakeTransferFeePercentage
        },
      };
      const mockServer = mock(relayServer);
      //   sinon.replaceGetter(rifClient, 'isDeployTransaction', () =>
      //         sinon.stub().resolves({} as DeployTransactionRequest)
      //   );

      sinon.stub(utils, 'getProvider').returns(providers.getDefaultProvider());
      mockServer.expects('_validateIfGasAmountIsEnough').resolves();
      sinon.replaceGetter(rifClient, 'standardMaxPossibleGasEstimation', () =>
        sinon.stub().resolves(BigNumber.from(fakeEstimationBeforeFees))
      );
      mockServer.expects('isSponsorshipAllowed').returns(false);
      sinon.stub(relayServer, 'config').value(fakeServerConfigParams);
      const token = {
        name: () => Promise.resolve('TestToken'),
        symbol: () => Promise.resolve('TT'),
        decimals: () => Promise.resolve(18),
      } as unknown as ERC20;
      sinon.stub(ERC20__factory, 'connect').returns(token);

      sinon.stub(Conversions, 'getXRateFor').resolves(tokenXRate);

      const maxPossibleGas = await relayServer.getMaxPossibleGas({
        relayRequest: {
          request: {
            tokenContract: constants.AddressZero,
            tokenGas: 200000,
            tokenAmount: tokenAmount,
            data: '0x23b872dd000000000000000000000000e87286ba960fa7aaa5b376083a31d440c8cb4bc80000000000000000000000008470af7f41ee2788eaa4cfc251927877b659cdc500000000000000000000000000000000000000000000000000000000000003e8'
          },
          relayData: {
            gasPrice: 1000,
          },
        },
      } as EnvelopingTxRequest);

      expect(maxPossibleGas.toString()).to.be.equal(
        (fakeEstimationBeforeFees + (valueToTransfer * fakeTransferFeePercentage)).toString()
      );
    });
  });
});
