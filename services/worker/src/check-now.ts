import { createLogger, failure, type CheckResultWithLocation } from '@flarewatch/shared';
import type { Env } from './env';
import type { WorkerDeps } from './index';
import { places, runBudget } from './checkers';

const log = createLogger('CheckNow');

export const CHECK_NOW_PREFIX = '/check/';

function refuse(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function parseVia(search: string): number | undefined | null {
  if (search === '') return undefined;
  const params = new URLSearchParams(search);
  const raw = params.get('via');
  if (params.size !== 1 || raw === null || !/^\d+$/.test(raw)) return null;
  const via = Number(raw);
  return Number.isSafeInteger(via) ? via : null;
}

/**
 * One check of a configured check monitor, for the operator, answered and
 * never recorded: MonitorHub.record takes a run as covering every monitor, so
 * recording one monitor would close the others' incidents. The id (and an
 * optional `via` index into the monitor's configured places) are the only
 * inputs; the target and proxy always come from the config.
 */
export async function handleCheckNow(
  request: Request,
  env: Env,
  deps: WorkerDeps,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.body !== null) {
    return refuse('Check now takes only a monitor id and optional via index', 400);
  }
  const via = parseVia(url.search);
  if (via === null) {
    return refuse('Invalid via index', 400);
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
  if (via !== undefined && via >= places(monitor).length) {
    return refuse('Invalid via index', 400);
  }

  let check: CheckResultWithLocation;
  try {
    check = await deps.checkMonitor(monitor, {
      env,
      budget: runBudget([monitor], 0),
      ...(via !== undefined && { via }),
    });
  } catch (error) {
    log.error('Check now failed', { monitor: monitor.id, error: String(error) });
    check = {
      location: await deps.getEdgeLocation(),
      result: failure(`Check failed: ${String(error)}`),
    };
  }
  return Response.json(check);
}
