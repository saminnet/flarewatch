import { getEdgeLocation as locateEdge } from '../../src/utils/location';
import type { WorkerConfig } from '@flarewatch/shared';
import { checkMonitor } from '../../src/checkers';
import { createNotifier } from '../../src/notifications/webhook';
import type { WorkerDeps } from '../../src/index';

export function createWorkerDeps(staticConfig: WorkerConfig): WorkerDeps {
  return {
    checkMonitor,
    createNotifier,
    getEdgeLocation: () => locateEdge(async () => new Response('colo=HEL\n')),
    staticConfig,
  };
}
