import fs from 'fs';
import { HttpServer } from '../HttpServer';
import { RelayServer } from '../RelayServer';
import { KeyManager } from '../KeyManager';
import { TxStoreManager, TXSTORE_FILENAME } from '../TxStoreManager';
import { ContractInteractor } from '@rsksmart/rif-relay-common';

// TODO check if this can be removed
import { configure } from '@rsksmart/rif-relay-client';
import log from 'loglevel';
import config from 'config';
import { JsonRpcProvider } from '@ethersproject/providers';
import type {
  AppConfig,
  ContractsConfig,
  ServerDependencies,
} from 'src/ServerConfigParams';

function error(err: string): void {
  log.error(err);
  process.exit(1);
}

async function run(): Promise<void> {
  try {
    log.info('Starting Enveloping Relay Server process...\n');
    const contractsConfig: ContractsConfig = config.get('contracts');
    const appConfig: AppConfig = config.get('app');
    log.setLevel(appConfig.logLevel);
    if (!config.has('blockchain.rskNodeUrl')) {
      error('missing rskNodeUrl');
    }
    const trustedVerifiers = contractsConfig.trustedVerifiers;

    const provider = new JsonRpcProvider(config.get('blockchain.rskNodeUrl'));
    log.debug('runServer() - provider done');
    // config = await resolveServerConfig(conf, provider);
    log.debug('runServer() - config done');
    if (trustedVerifiers && trustedVerifiers.length > 0) {
      contractsConfig.trustedVerifiers = trustedVerifiers;
    }
    const devMode: boolean = appConfig.devMode;
    const workdir: string = appConfig.workdir;
    if (devMode) {
      if (fs.existsSync(`${workdir}/${TXSTORE_FILENAME}`)) {
        fs.unlinkSync(`${workdir}/${TXSTORE_FILENAME}`);
      }
    }

    const managerKeyManager = new KeyManager(1, workdir + '/manager');
    const workersKeyManager = new KeyManager(1, workdir + '/workers');
    log.debug('runServer() - manager and workers configured');
    const txStoreManager = new TxStoreManager({ workdir });
    const contractInteractor = await ContractInteractor.getInstance(
      provider,
      configure({
        relayHubAddress: contractsConfig.relayHubAddress,
        deployVerifierAddress: contractsConfig.deployVerifierAddress,
        relayVerifierAddress: contractsConfig.relayVerifierAddress,
      })
    );
    log.debug('runServer() - contract interactor initilized');

    const dependencies: ServerDependencies = {
      txStoreManager,
      managerKeyManager,
      workersKeyManager,
      contractInteractor,
    };

    const relayServer = new RelayServer(dependencies);
    await relayServer.init();
    log.debug('runServer() - Relay Server initialized');
    const httpServer = new HttpServer(appConfig.port, relayServer);
    httpServer.start();
    log.debug('runServer() - Relay Server started');
  } catch (e) {
    if (e instanceof Error) {
      error(e.message);
    } else {
      log.error(e);
    }
  }
}

run()
  .then(() => {
    log.debug('runServer() - Relay Server running');
  })
  .catch((error) => {
    log.error('runServer() - Error running server', error);
  });
