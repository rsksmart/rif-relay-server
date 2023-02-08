import { expect } from 'chai';
import config from 'config';
import { buildServerUrl, getServerConfig, ServerConfigParams } from '../../src';

const originalConfig = config.util.toObject(config) as ServerConfigParams;

describe('Utils', function () {
  describe('buildServerUrl', function () {
    afterEach(function () {
      config.util.extendDeep(config, originalConfig);
    });

    it('should build server url', function () {
      const {
        app: { url, port },
      } = getServerConfig();

      const expectedUrl = new URL(`${url}:${port}`);

      const serverUrl = buildServerUrl();

      expect(expectedUrl.toString()).to.be.equal(serverUrl);
    });

    it('should throw if url is not valid', function () {
      config.util.extendDeep(config, {
        app: {
          url: 'bad_url',
        },
      });

      expect(() => buildServerUrl()).to.throw('Invalid URL');
    });

    it('should throw if port is not valid', function () {
      config.util.extendDeep(config, {
        app: {
          port: 'bad_port',
        },
      });

      expect(() => buildServerUrl()).to.throw('Port should be numeric');
    });
  });
});