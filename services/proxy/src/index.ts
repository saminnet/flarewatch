import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import type { CheckResultWithLocation, MonitorTarget } from '@flarewatch/shared';
import { createLogger } from '@flarewatch/shared';
import { checkMonitor } from './checkers';
import { getLocation, setLocation } from './utils/location';

const log = createLogger('Proxy');

export interface ProxyConfig {
  /** Optional Bearer token for authentication */
  authToken?: string | undefined;
  /** Custom location string (overrides auto-detection) */
  location?: string | undefined;
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Zod schema for validating monitor target requests
 */
const MonitorTargetSchema = z.object({
  id: z.string().min(1, 'id must be a non-empty string').default('unknown'),
  name: z.string().min(1, 'name must be a non-empty string').optional(),
  method: z.string().min(1, 'method must be a non-empty string').default('GET'),
  target: z.string().min(1, 'target URL is required'),
  timeout: z.number().positive('timeout must be a positive number').optional(),
  expectedCodes: z.array(z.number().int('expectedCodes must be integers')).optional(),
  headers: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  body: z.string().optional(),
  responseKeyword: z.string().optional(),
  responseForbiddenKeyword: z.string().optional(),
  checkProxy: z.string().optional(),
  sslCheckEnabled: z.boolean().optional(),
  sslCheckDaysBeforeExpiry: z
    .number()
    .nonnegative('sslCheckDaysBeforeExpiry must be non-negative')
    .optional(),
  sslIgnoreSelfSigned: z.boolean().optional(),
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
  // Set name to id if not provided
  const data = result.data;
  return {
    ok: true,
    monitor: { ...data, name: data.name ?? data.id } as MonitorTarget,
  };
}

/**
 * Shared handler for check endpoints
 */
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

    log.info('Completed', { status: result.ok ? 'UP' : 'DOWN', location });
    return c.json({ location, result } satisfies CheckResultWithLocation);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Error', { error: errorMessage });
    return c.json({ error: errorMessage }, 500);
  }
}

/**
 * Create a Hono application for the proxy
 */
export function createProxy(config: ProxyConfig = {}) {
  const app = new Hono();

  // Set custom location if provided
  if (config.location) {
    setLocation(config.location);
  }

  // Enable CORS for browser-based testing
  app.use('/*', cors());

  // Health check endpoint
  app.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: Date.now() });
  });

  // Authentication middleware for check endpoints
  if (config.authToken) {
    const expectedAuth = `Bearer ${config.authToken}`;

    app.use('/check', async (c, next) => {
      const auth = c.req.header('Authorization') ?? '';
      if (!timingSafeEqual(auth, expectedAuth)) {
        log.info('Unauthorized request');
        return c.json({ error: 'Unauthorized' }, 401);
      }
      return next();
    });
  }

  // Main check endpoint (POST /check)
  app.post('/check', handleCheckRequest);

  // Root GET - info page
  app.get('/', (c) => {
    return c.json({
      name: 'FlareWatch Proxy',
      version: '1.0.0',
      endpoints: {
        'GET /': 'This info page',
        'GET /health': 'Health check',
        'POST /check': 'Execute a monitor check',
      },
      docs: 'https://github.com/saminnet/flarewatch',
    });
  });

  return app;
}
