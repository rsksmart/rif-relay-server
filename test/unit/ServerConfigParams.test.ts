import {
  verifyServerConfiguration,
  AppConfig,
  ContractsConfig,
  ServerConfigParams,
  ERROR_DISABLE_SPONSOR_TX_NOT_CONFIGURED,
  ERROR_GAS_FEE_PERCENTAGE_NEGATIVE,
  ERROR_TRANSFER_FEE_PERCENTAGE_NEGATIVE,
  ERROR_FIXED_USD_FEE_NEGATIVE,
} from '../../src/ServerConfigParams';
import { ethers } from 'ethers';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);

describe('ServerConfigParams tests', function () {
  describe('Function verifyServerConfiguration()', function () {
    let contracts: ContractsConfig;
    let app: AppConfig;
    let randomAddress: string;

    before(function () {
      randomAddress = ethers.Wallet.createRandom().address;
    });

    beforeEach(function () {
      app = {
        url: 'https://fake.rsk',
        port: 8080,
        workdir: '/some/dir',
      } as AppConfig;

      contracts = {
        relayHubAddress: randomAddress,
      } as ContractsConfig;
    });

    it('Should fail if disableSponsoredTx is not properly configured', function () {
      expect(() =>
        verifyServerConfiguration({ app, contracts } as ServerConfigParams)
      ).to.throw(ERROR_DISABLE_SPONSOR_TX_NOT_CONFIGURED);
    });

    it('Should pass if it is sponsored even if none fee is configured', function () {
      app.disableSponsoredTx = false;

      expect(() =>
        verifyServerConfiguration({ app, contracts } as ServerConfigParams)
      ).not.to.throw();
    });
    describe('When is not sponsored', function () {
      beforeEach(function () {
        app.disableSponsoredTx = true;
      });

      it('Should fail if gasFeePercentage is a negative value', function () {
        app.gasFeePercentage = -0.1;

        expect(() =>
          verifyServerConfiguration({ app, contracts } as ServerConfigParams)
        ).to.throw(ERROR_GAS_FEE_PERCENTAGE_NEGATIVE);
      });

      it('Should fail if transferFeePercentage is a negative value', function () {
        app.transferFeePercentage = -0.01;

        expect(() =>
          verifyServerConfiguration({ app, contracts } as ServerConfigParams)
        ).to.throw(ERROR_TRANSFER_FEE_PERCENTAGE_NEGATIVE);
      });

      it('Should fail if fixedUsdFee is a negative value', function () {
        app.fixedUsdFee = -1;

        expect(() =>
          verifyServerConfiguration({ app, contracts } as ServerConfigParams)
        ).to.throw(ERROR_FIXED_USD_FEE_NEGATIVE);
      });

      it('Should pass even if all fee parameters are undefined', function () {
        expect(() =>
          verifyServerConfiguration({ app, contracts } as ServerConfigParams)
        ).not.to.throw();
      });

      it('Should pass if only gasFeePercentage is properly configured', function () {
        app.gasFeePercentage = 0.1;

        expect(() =>
          verifyServerConfiguration({ app, contracts } as ServerConfigParams)
        ).not.to.throw();
      });

      it('Should pass if only transferFeePercentage is properly configured', function () {
        app.transferFeePercentage = 0.01;

        expect(() =>
          verifyServerConfiguration({ app, contracts } as ServerConfigParams)
        ).not.to.throw();
      });

      it('Should pass if only fixedUsdFee is properly configured', function () {
        app.fixedUsdFee = 1;

        expect(() =>
          verifyServerConfiguration({ app, contracts } as ServerConfigParams)
        ).not.to.throw();
      });

      it('Should pass if more than one fee is properly configured', function () {
        app.fixedUsdFee = 1;
        app.gasFeePercentage = 0.1;

        expect(() =>
          verifyServerConfiguration({ app, contracts } as ServerConfigParams)
        ).not.to.throw();
      });
    });
  });
});
