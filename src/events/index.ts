import type { RelayServer } from 'src/RelayServer';
import {
  EVENT_REPLENISH_CHECK_REQUIRED,
  checkReplenish,
} from './checkReplenish';

export const registerEventHandlers = (relayServer: RelayServer) => {
  relayServer.on(EVENT_REPLENISH_CHECK_REQUIRED, checkReplenish);
};
