import type { NotificationContext } from '../../src/notifications/webhook';
import { createMonitor } from '../../../../packages/shared/tests/helpers/monitors';

/** A down alert as it opens; a test overrides the fields it is about. */
export function notificationContext(
  overrides: Partial<NotificationContext> = {},
): NotificationContext {
  return {
    monitor: createMonitor(),
    kind: 'down',
    incidentStartTime: 1000,
    currentTime: 1000,
    downtimeSeconds: 0,
    reason: 'Connection refused',
    timeZone: 'UTC',
    alsoDown: [],
    ...overrides,
  };
}
