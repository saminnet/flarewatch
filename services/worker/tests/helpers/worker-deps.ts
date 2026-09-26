import type { WorkerConfig } from '@flarewatch/shared';
import { checkMonitor } from '../../src/checkers';
import type { WorkerDeps } from '../../src/index';

export function createWorkerDeps(staticConfig: WorkerConfig): WorkerDeps {
  return {
    checkMonitor,
    createNotifier: () => null,
    formatNotificationMessage: () => 'notification',
    getEdgeLocation: async () => 'HEL',
    staticConfig,
  };
}
