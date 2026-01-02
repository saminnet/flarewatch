import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { checkMonitor } from './checkers';
import { createLogger } from './log';
import type { CheckResultWithLocation, MonitorTarget } from './types';
import { getErrorMessage } from './utils';
import { getLocation, setLocation } from './utils/location';

const log = createLogger('Proxy');

export interface ProxyConfig {
  authToken: string;
  location?: string | undefined;
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);

  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

const MonitorTargetSchema = z.object({
  body: z.string().optional(),
  expectedCodes: z.array(z.number().int('expectedCodes must be integers')).optional(),
  headers: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  id: z.string().min(1, 'id must be a non-empty string').default('unknown'),
  method: z.string().min(1, 'method must be a non-empty string').default('GET'),
  name: z.string().min(1, 'name must be a non-empty string').optional(),
  responseForbiddenKeyword: z.string().optional(),
  responseKeyword: z.string().optional(),
  sslCheckDaysBeforeExpiry: z
    .number()
    .nonnegative('sslCheckDaysBeforeExpiry must be non-negative')
    .optional(),
  sslCheckEnabled: z.boolean().optional(),
  sslIgnoreSelfSigned: z.boolean().optional(),
  target: z.string().min(1, 'target URL is required'),
  timeout: z.number().positive('timeout must be a positive number').optional(),
});

function parseMonitorTarget(
  value: unknown,
): { ok: true; monitor: MonitorTarget } | { ok: false; error: string } {
  const result = MonitorTargetSchema.safeParse(value);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const path = firstIssue?.path.join('.') || '';
    const message = firstIssue?.message ?? 'Invalid request body';
    return { ok: false, error: path ? `${path}: ${message}` : message };
  }
  const data = result.data;
  return {
    ok: true,
    monitor: { ...data, name: data.name ?? data.id } as MonitorTarget,
  };
}

async function handleCheckRequest(c: Context): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = parseMonitorTarget(body);
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }

    const monitor = parsed.monitor;
    log.info('Starting check', { name: monitor.name ?? monitor.id });

    const location = await getLocation();
    const result = await checkMonitor(monitor);

    log.info('Completed', { location, status: result.ok ? 'UP' : 'DOWN' });
    return c.json({ location, result } satisfies CheckResultWithLocation);
  } catch (error) {
    const message = getErrorMessage(error);
    log.error('Error', { error: message });
    return c.json({ error: message }, 500);
  }
}

export function createProxy(config: ProxyConfig) {
  const app = new Hono();

  if (config.location) {
    setLocation(config.location);
  }

  app.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: Date.now() });
  });

  const expectedAuth = `Bearer ${config.authToken}`;

  app.use('/check', async (c, next) => {
    const auth = c.req.header('Authorization') ?? '';
    if (!timingSafeEqual(auth, expectedAuth)) {
      log.info('Unauthorized request');
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
  });

  app.post('/check', handleCheckRequest);

  app.get('/', (c) => {
    return c.json({
      docs: 'https://github.com/saminnet/flarewatch',
      endpoints: {
        'GET /': 'This info page',
        'GET /health': 'Health check',
        'POST /check': 'Execute a monitor check',
      },
      name: 'FlareWatch Proxy',
      version: '1.0.0',
    });
  });

  return app;
}
