import { createLogger, failure, type CheckResultWithLocation } from '@flarewatch/shared';
import type { Env } from './env';
import type { WorkerDeps } from './index';
import { runBudget } from './checkers';

const log = createLogger('CheckNow');

export const CHECK_NOW_PREFIX = '/check/';

function refuse(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

/**
 * One check of a configured check monitor, for the operator, answered and
 * never recorded: MonitorHub.record takes a run as covering every monitor, so
 * recording one monitor would close the others' incidents. The id is the only
 * input; the target and proxy come from the config.
 */
export async function handleCheckNow(
  request: Request,
  env: Env,
  deps: WorkerDeps,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.search !== '' || request.body !== null) {
    return refuse('Check now takes only a monitor id', 400);
  }

  let id: string;
  try {
    id = decodeURIComponent(url.pathname.slice(CHECK_NOW_PREFIX.length));
  } catch {
    return refuse('Invalid id', 400);
  }

  const monitor = deps.staticConfig.monitors.find((candidate) => candidate.id === id);
  if (!monitor) return refuse('Unknown monitor', 404);
  if (monitor.method === 'HEARTBEAT') return refuse('A heartbeat monitor has no check to run', 400);

  let check: CheckResultWithLocation;
  try {
    check = await deps.checkMonitor(monitor, { env, budget: runBudget([monitor], 0) });
  } catch (error) {
    log.error('Check now failed', { monitor: monitor.id, error: String(error) });
    check = {
      location: await deps.getEdgeLocation(),
      result: failure(`Check failed: ${String(error)}`),
    };
  }
  return Response.json(check);
}
