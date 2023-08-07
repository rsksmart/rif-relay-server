import type { RelayServer } from 'src/RelayServer';
import {
  EVENT_REPLENISH_CHECK_REQUIRED as replenishCheckRequiredEvent,
  checkReplenish,
} from './checkReplenish';

export const registerEventHandlers = (relayServer: RelayServer) => {
  relayServer.on(replenishCheckRequiredEvent, checkReplenish);
};

export const EVENT_REPLENISH_CHECK_REQUIRED = replenishCheckRequiredEvent;
