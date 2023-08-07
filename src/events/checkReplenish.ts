import type { RelayServer } from '../RelayServer';
import { replenishStrategy } from '../ReplenishFunction';
import log from 'loglevel';

export const EVENT_REPLENISH_CHECK_REQUIRED = 'REPLENISH_CHECK_REQUIRED';

export const checkReplenish = (
  relayServer: RelayServer,
  workerIndex: number,
  currentBlock: number
) => {
  replenishStrategy(relayServer, workerIndex, currentBlock)
    .then((txHashes) => {
      if (txHashes && txHashes.length) {
        log.info(`checkReplenish: Server replenished`, txHashes);

        return;
      }
      log.info(`checkReplenish: Replenishment wasn't required`);
    })
    .catch((err) =>
      log.error(`checkReplenish: Error while replenishing the server`, err)
    );
};
