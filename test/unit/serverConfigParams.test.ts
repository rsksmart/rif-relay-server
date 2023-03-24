import {
  verifyServerConfiguration,
  ServerConfigParams,
} from '../../src/ServerConfigParams';
import { Wallet } from 'ethers';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import config from 'config';
import {
  ERROR_GAS_FEE_PERCENTAGE_NEGATIVE,
  ERROR_FIXED_USD_FEE_NEGATIVE,
} from '../../src/definitions/errorMessages.const';

use(chaiAsPromised);

describe('ServerConfigParams tests', function () {
  //Not all cases are tested here since the validation is made using an external library and it makes no sense
  //to test the library here. The test are focused in the custom functions of /serverConfigParamsUtils.ts
  //and the conditional validations in /ServerConfigParams.ts
  describe('Function verifyServerConfiguration()', function () {
    let originalConfig: ServerConfigParams;

    before(function () {
      originalConfig = config.util.toObject(config) as ServerConfigParams;
    });

    afterEach(function () {
      config.util.extendDeep(config, originalConfig);
    });

    it('Should pass with default configuration', function () {
      config.util.extendDeep(config, { app: { disableSponsoredTx: false } });

      expect(() => verifyServerConfiguration()).not.to.throw();
    });

    it('Should fail if disableSponsoredTx is not configured', function () {
      config.util.extendDeep(config, {
        app: { disableSponsoredTx: undefined },
      });

      expect(() => verifyServerConfiguration()).to.throw(
        'Server configuration error:  "app.disableSponsoredTx" is required'
      );
    });

    it('Should pass if it is sponsored, even if none fee is configured', function () {
      config.util.extendDeep(config, { app: { disableSponsoredTx: false } });

      expect(() => verifyServerConfiguration()).not.to.throw();
    });

    describe('When is not sponsored', function () {
      beforeEach(function () {
        config.util.extendDeep(config, { app: { disableSponsoredTx: true } });
      });

      it('Should fail if gasFeePercentage is a negative value', function () {
        config.util.extendDeep(config, { app: { gasFeePercentage: '-1' } });

        expect(() => verifyServerConfiguration()).to.throw(
          ERROR_GAS_FEE_PERCENTAGE_NEGATIVE
        );
      });

      it('Should fail if fixedUsdFee is a negative value', function () {
        config.util.extendDeep(config, { app: { fixedUsdFee: '-1' } });

        expect(() => verifyServerConfiguration()).to.throw(
          ERROR_FIXED_USD_FEE_NEGATIVE
        );
      });

      //The next two use cases can be confusing because if the operation is not sponsored and there are not
      //fees configured, then what is it charging to the user? Here the server will only charge the gas
      //cost of the operation but not any additional value.
      it('Should pass even if all fee parameters are undefined', function () {
        config.util.extendDeep(config, {
          app: {
            fixedUsdFee: undefined,
            gasFeePercentage: undefined,
            transferFeePercentage: undefined,
          },
        });

        expect(() => verifyServerConfiguration()).not.to.throw();
      });

      it('Should pass even if all fee parameters are disabled', function () {
        config.util.extendDeep(config, {
          app: {
            fixedUsdFee: 0,
            gasFeePercentage: 0,
            transferFeePercentage: -1,
          },
        });

        expect(() => verifyServerConfiguration()).not.to.throw();
      });

      it('Should pass if only gasFeePercentage is properly configured', function () {
        config.util.extendDeep(config, { app: { gasFeePercentage: 0.1 } });

        expect(() => verifyServerConfiguration()).not.to.throw();
      });

      it('Should pass if only transferFeePercentage is properly configured', function () {
        config.util.extendDeep(config, {
          app: { transferFeePercentage: 0.01 },
        });

        expect(() => verifyServerConfiguration()).not.to.throw();
      });

      it('Should pass if only fixedUsdFee is properly configured', function () {
        config.util.extendDeep(config, { app: { fixedUsdFee: 1 } });

        expect(() => verifyServerConfiguration()).not.to.throw();
      });

      it('Should pass if more than one fee is properly configured', function () {
        config.util.extendDeep(config, {
          app: { fixedUsdFee: 1, gasFeePercentage: 0.1 },
        });

        expect(() => verifyServerConfiguration()).not.to.throw();
      });
    });

    describe('Custom functions on /serverConfigParamsUtils.ts', function () {
      it('Should fail if the string representation of a BigNumber is incorrect', function () {
        config.util.extendDeep(config, {
          blockchain: { workerMinBalance: '1e10' },
        });

        expect(() => verifyServerConfiguration()).to.throw(
          '"blockchain.workerMinBalance" failed custom validation because Invalid BigNumber string representation: 1e10'
        );
      });

      it('Should pass if the string representation of a BigNumber is correct', function () {
        config.util.extendDeep(config, {
          blockchain: {
            workerMinBalance: '1035386848354684654698546564654654',
          },
        });

        expect(() => verifyServerConfiguration()).not.to.throw();
      });

      it('Should fail if an address is incorrect', function () {
        const wrongAddress = Wallet.createRandom()
          .address.toString()
          .slice(0, -1);

        config.util.extendDeep(config, {
          app: { sponsoredDestinations: [wrongAddress] },
        });

        expect(() => verifyServerConfiguration()).to.throw(
          'Server configuration error:  "app.sponsoredDestinations[0]" failed custom validation because Invalid address:'
        );
      });

      it('Should pass if an address is correct', function () {
        const correctAddress = Wallet.createRandom().address.toString();

        config.util.extendDeep(config, {
          app: { sponsoredDestinations: [correctAddress] },
        });

        expect(() => verifyServerConfiguration()).not.to.throw();
      });

      it('Should fail if a PK is incorrect', function () {
        const wrongPK = Wallet.createRandom()
          .privateKey.toString()
          .slice(0, -1);

        config.util.extendDeep(config, {
          register: { privateKey: wrongPK },
        });

        expect(() => verifyServerConfiguration()).to.throw(
          'Server configuration error:  "register.privateKey" failed custom validation because Invalid PK:'
        );
      });

      it('Should pass if a PK is correct', function () {
        const correctPK = Wallet.createRandom().privateKey.toString();

        config.util.extendDeep(config, {
          register: { privateKey: correctPK },
        });

        expect(() => verifyServerConfiguration()).not.to.throw();
      });

      it('Should fail if the mnemonic is incorrect', function () {
        const wrongMnemonic = Wallet.createRandom().mnemonic.phrase.slice(
          0,
          -1
        );

        config.util.extendDeep(config, {
          register: { mnemonic: wrongMnemonic },
        });

        expect(() => verifyServerConfiguration()).to.throw(
          'Server configuration error:  "register.mnemonic" failed custom validation because Invalid Mnemonic:'
        );
      });

      it('Should pass if the mnemonic is correct', function () {
        const correctMnemonic = Wallet.createRandom().mnemonic.phrase;

        config.util.extendDeep(config, {
          register: { mnemonic: correctMnemonic },
        });

        expect(() => verifyServerConfiguration()).not.to.throw();
      });
    });
  });
});
