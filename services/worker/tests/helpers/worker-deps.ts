import type { Fetcher, WorkerConfig } from '@flarewatch/shared';
import { checkMonitor } from '../../src/checkers';
import { defaultCheckDeps, type CheckDeps } from '../../src/checkers/deps';
import { GlobalPingChecker } from '../../src/checkers/globalping';
import { HttpChecker } from '../../src/checkers/http';
import { TcpChecker } from '../../src/checkers/tcp';
import { createNotifier } from '../../src/notifications/webhook';
import type { WorkerDeps } from '../../src/index';

type Connect = ConstructorParameters<typeof TcpChecker>[0];

/** A socket a test does not expect: any TCP check fails it loudly. */
export const refuseSockets: Connect = async () => {
  throw new Error('Unexpected socket');
};

/** The checkers over `fetcher` and `connect`, at a fixed edge location. */
export function createCheckDeps(
  fetcher: Fetcher,
  connect: Connect = refuseSockets,
  location = 'HEL',
): CheckDeps {
  return {
    http: new HttpChecker(fetcher),
    tcp: new TcpChecker(connect),
    globalPing: new GlobalPingChecker(fetcher),
    getEdgeLocation: async () => location,
    fetcher,
  };
}

/**
 * The worker's collaborators for `staticConfig`, at a fixed edge location. Checks go
 * over `fetcher` when one is given, otherwise over the global fetch.
 */
export function createWorkerDeps(
  staticConfig: WorkerConfig,
  {
    fetcher,
    connect,
    location = 'HEL',
  }: { fetcher?: Fetcher; connect?: Connect; location?: string } = {},
): WorkerDeps {
  const checkDeps = fetcher
    ? createCheckDeps(fetcher, connect, location)
    : { ...defaultCheckDeps, getEdgeLocation: async () => location };
  return {
    checkMonitor: (target, ctx) => checkMonitor(target, ctx, checkDeps),
    createNotifier,
    getEdgeLocation: checkDeps.getEdgeLocation,
    staticConfig,
  };
}
