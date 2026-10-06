import {
  type CheckContext,
  type CheckResultWithLocation,
  type Monitor,
  type MonitorTarget,
  type PullMethod,
  type RunBudget,
  DEFAULT_HTTP_TIMEOUT,
  TimeoutError,
  createLogger,
  failure,
  withTimeout,
} from '@flarewatch/shared';
import { defaultCheckDeps, type CheckDeps } from './deps';
import { PREPAID_REQUESTS } from './globalping';
import { checkExternalProxy } from './proxy';

const log = createLogger('Check');

/** Workers Free plan: subrequests per invocation. Each check, Globalping call and hub RPC is one. */
const SUBREQUEST_LIMIT = 50;
/** The edge-location lookup, the hub's record call and its alert confirmation. */
const RESERVED_SUBREQUESTS = 3;
/** Checks end this long after the run starts; the rest of the minute goes to the hub and alerts. */
const CHECK_WINDOW_MS = 55_000;
/** An extra attempt needs at least this much of the window left to be worth starting. */
const MIN_ATTEMPT_MS = 1_000;

const ALL_METHODS: readonly PullMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TCP_PING',
];

type Adapter = 'direct' | 'globalping' | 'proxy';

interface Capabilities {
  label: string;
  /** The fewest subrequests one attempt costs. */
  subrequests: number;
  methods: readonly PullMethod[];
  body: boolean;
  sslCheck: boolean;
  icmp: boolean;
  responseHeaders: boolean;
  responseJson: boolean;
}

const CAPABILITIES: Record<Adapter, Capabilities> = {
  // A Worker's fetch never exposes the peer certificate, and connect() speaks only TCP.
  direct: {
    label: 'a direct check',
    subrequests: 1,
    methods: ALL_METHODS,
    body: true,
    sslCheck: false,
    icmp: false,
    responseHeaders: true,
    responseJson: true,
  },
  // Further polls spend the run's spare subrequests as they go.
  globalping: {
    label: 'Globalping',
    subrequests: PREPAID_REQUESTS,
    methods: ['GET', 'HEAD', 'OPTIONS', 'TCP_PING'],
    body: false,
    sslCheck: true,
    icmp: true,
    // A measurement reports the body but not the headers.
    responseHeaders: false,
    responseJson: true,
  },
  // A proxy older than 2.0.0 drops header and JSON fields and sends no contract 2.
  proxy: {
    label: 'an external proxy',
    subrequests: 1,
    methods: ALL_METHODS,
    body: true,
    sslCheck: true,
    icmp: false,
    responseHeaders: true,
    responseJson: true,
  },
};

type Attempt =
  | { adapter: 'direct'; via?: 'checkProxyFallback' }
  | { adapter: 'globalping' | 'proxy'; url: string; via: 'checkProxy' | 'confirmVia' };

function locate(url: string, via: 'checkProxy' | 'confirmVia'): Attempt {
  return { adapter: url.startsWith('globalping://') ? 'globalping' : 'proxy', url, via };
}

/** Where to check, in order: each later attempt runs only when the one before it failed. */
function plan(target: MonitorTarget): [Attempt, ...Attempt[]] {
  const attempts: [Attempt, ...Attempt[]] = [
    target.checkProxy ? locate(target.checkProxy, 'checkProxy') : { adapter: 'direct' },
  ];
  if (target.checkProxy && target.checkProxyFallback) {
    attempts.push({ adapter: 'direct', via: 'checkProxyFallback' });
  }
  if (target.confirmVia) attempts.push(locate(target.confirmVia, 'confirmVia'));
  return attempts;
}

/** A TCP_PING only connects, wherever it runs: no status, body, headers or certificate to check. */
const HTTP_ONLY = [
  'expectedCodes',
  'responseKeyword',
  'responseForbiddenKeyword',
  'responseJsonPath',
  'responseHeaderEquals',
  'sslCheckEnabled',
] as const;

function methodRefusal(target: MonitorTarget): string | undefined {
  if (target.method !== 'TCP_PING') return undefined;
  const field = HTTP_ONLY.find((name) => target[name] !== undefined && target[name] !== false);
  return field && `${field} is not supported by TCP_PING`;
}

function refusal(target: MonitorTarget, attempt: Attempt): string | undefined {
  const can = CAPABILITIES[attempt.adapter];
  const demands: [string, boolean, boolean][] = [
    [`method ${target.method}`, true, can.methods.includes(target.method)],
    ['body', target.body !== undefined, can.body],
    ['sslCheckEnabled', target.sslCheckEnabled === true, can.sslCheck],
    ["pingProtocol 'icmp'", target.pingProtocol === 'icmp', can.icmp],
    ['responseHeaderEquals', target.responseHeaderEquals !== undefined, can.responseHeaders],
    ['responseJsonPath', target.responseJsonPath !== undefined, can.responseJson],
  ];
  const unmet = demands.find(([, asked, supported]) => asked && !supported);
  if (!unmet) return undefined;
  return `${attempt.via ? `${attempt.via}: ` : ''}${unmet[0]} is not supported by ${can.label}`;
}

/** What this monitor asks of a place that cannot honour it. Empty when every attempt can run. */
export function planIssues(target: MonitorTarget): string[] {
  return [methodRefusal(target), ...plan(target).map((attempt) => refusal(target, attempt))].filter(
    (issue) => issue !== undefined,
  );
}

/**
 * The budget for one check run starting now: its deadline and the subrequests left for extras.
 * Each webhook is held one request first, so the first alert of the run always goes out.
 */
export function runBudget(
  monitors: readonly Monitor[],
  webhooks: number,
  now = Date.now(),
): RunBudget {
  let primaries = 0;
  for (const monitor of monitors) {
    if (monitor.method !== 'HEARTBEAT') {
      primaries += CAPABILITIES[plan(monitor)[0].adapter].subrequests;
    }
  }
  return {
    deadline: now + CHECK_WINDOW_MS,
    subrequests: Math.max(0, SUBREQUEST_LIMIT - RESERVED_SUBREQUESTS - webhooks - primaries),
  };
}

function afford(budget: RunBudget, attempt: Attempt): boolean {
  const cost = CAPABILITIES[attempt.adapter].subrequests;
  if (budget.deadline - Date.now() < MIN_ATTEMPT_MS || budget.subrequests < cost) return false;
  budget.subrequests -= cost;
  return true;
}

async function run(
  target: MonitorTarget,
  attempt: Attempt,
  ctx: CheckContext,
  deps: CheckDeps,
): Promise<CheckResultWithLocation> {
  if (attempt.adapter === 'globalping') {
    return deps.globalPing.check(target, attempt.url, ctx.budget);
  }
  if (attempt.adapter === 'proxy') {
    return checkExternalProxy(target, attempt.url, ctx.env, deps.fetcher);
  }
  const location = await deps.getEdgeLocation();
  const checker = target.method === 'TCP_PING' ? deps.tcp : deps.http;
  return { location, result: await checker.check(target) };
}

/** One attempt, its timeout cut to what is left of the run, and stopped at the deadline. */
async function attempt(
  target: MonitorTarget,
  next: Attempt,
  ctx: CheckContext,
  deps: CheckDeps,
): Promise<CheckResultWithLocation> {
  const remaining = Math.max(0, ctx.budget.deadline - Date.now());
  const timeout = Math.min(target.timeout ?? DEFAULT_HTTP_TIMEOUT, remaining);
  try {
    return await withTimeout(run({ ...target, timeout }, next, ctx, deps), remaining);
  } catch (error) {
    if (!(error instanceof TimeoutError)) throw error;
    return {
      location: await deps.getEdgeLocation(),
      result: failure('Check stopped at the end of the check run', remaining),
    };
  }
}

/**
 * Checks a monitor where its config says, then falls back or confirms elsewhere when that fails
 * and the run can afford it. Never throws, and never runs past `ctx.budget.deadline`.
 */
export async function checkMonitor(
  target: MonitorTarget,
  ctx: CheckContext,
  deps: CheckDeps = defaultCheckDeps,
): Promise<CheckResultWithLocation> {
  try {
    const [issue] = planIssues(target);
    if (issue) return { location: await deps.getEdgeLocation(), result: failure(issue) };

    const [first, ...rest] = plan(target);
    let checked = await attempt(target, first, ctx, deps);
    for (const next of rest) {
      if (checked.result.ok) break;
      if (!afford(ctx.budget, next)) {
        log.info('No budget left for another attempt', { monitor: target.id });
        break;
      }
      checked = await attempt(target, next, ctx, deps);
    }
    return checked;
  } catch (error) {
    log.error('Check failed', { monitor: target.id, error: String(error) });
    return {
      location: await deps.getEdgeLocation(),
      result: failure(`Check failed: ${String(error)}`),
    };
  }
}
