import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { workerConfig } from '@flarewatch/config/worker';
import { forgetCachedView } from '@/lib/snapshots';
import { authMiddlewareServer } from '@/server/auth-middleware';
import { Route } from '@/routes/api/badge[.]svg';

const T = Date.parse('2025-01-15T12:00:00Z') / 1000;
const originalMonitors = workerConfig.monitors;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  workerConfig.monitors = originalMonitors;
  forgetCachedView();
});

function stubView(status: 'up' | 'down' = 'up', extra = {}) {
  vi.stubEnv('DEV', false);
  vi.stubGlobal('__env__', {
    MONITOR_WORKER: {
      fetch: async () =>
        Response.json({
          lastUpdate: T,
          maintenances: [],
          announcements: [],
          monitors: {
            demo_example: {
              status,
              startedAt: T,
              incidents: status === 'down' ? [{ start: [T], error: ['Outage'] }] : [],
              ...extra,
            },
          },
        }),
    },
  });
}

type Handler = (ctx: { request: Request }) => Promise<Response>;
function get(path = '/api/badge.svg?id=demo_example') {
  const options = Route.options as { server?: { handlers?: Record<string, Handler> } };
  const handler = options.server?.handlers?.GET;
  if (!handler) throw new Error('Missing badge SVG GET');
  const request = new Request(`https://flarewatch.test${path}`);
  return authMiddlewareServer({
    request,
    pathname: new URL(request.url).pathname,
    next: () => handler({ request }),
  } as never) as Promise<Response>;
}

describe('GET /api/badge.svg', () => {
  it('serves a flat badge with its security and JSON cache headers', async () => {
    stubView();
    const response = await get('/api/badge.svg?id=demo_example&label=api&up=OK');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0, must-revalidate');
    const svg = await response.text();
    expect(svg).toContain('fill="#555"');
    expect(svg).toContain('fill="#4c1"');
    expect(svg).toContain('>api</text>');
    expect(svg).toContain('>OK</text>');
    expect(svg).not.toContain('linearGradient');
    const narrow = await (await get('/api/badge.svg?id=demo_example&label=iii')).text();
    const wide = await (await get('/api/badge.svg?id=demo_example&label=WWW')).text();
    expect(Number(narrow.match(/width="(\d+)"/)?.[1])).toBeLessThan(
      Number(wide.match(/width="(\d+)"/)?.[1]),
    );
  });

  it('maps down and degraded messages and accepts named and hex colors', async () => {
    stubView('down');
    const down = await get('/api/badge.svg?id=demo_example&down=OUT&colorDown=important');
    const downSvg = await down.text();
    expect(downSvg).toContain('fill="#fe7d37"');
    expect(downSvg).toContain('>OUT</text>');
    forgetCachedView();
    workerConfig.monitors = originalMonitors.map((m) =>
      m.id === 'demo_example' ? { ...m, maxLatencyMs: 10 } : m,
    );
    stubView('up', { latest: { ping: 100, loc: 'HEL', time: T } });
    const degraded = await get(
      '/api/badge.svg?id=demo_example&degraded=SLOW&colorDegraded=%23123abc',
    );
    const degradedSvg = await degraded.text();
    expect(degradedSvg).toContain('fill="#123abc"');
    expect(degradedSvg).toContain('>SLOW</text>');
    expect(await (await get('/api/badge.svg?id=demo_example&colorDegraded=abc')).text()).toContain(
      'fill="#abc"',
    );
  });

  it('rejects color injection and inherited object keys', async () => {
    stubView();
    for (const color of [
      'url(https://evil.test)',
      'constructor',
      '__proto__',
      'toString',
      '#1234',
      '" onload="alert(1)',
    ]) {
      const svg = await (
        await get(`/api/badge.svg?id=demo_example&colorUp=${encodeURIComponent(color)}`)
      ).text();
      expect(svg).toContain('fill="#4c1"');
      expect(svg).not.toContain('onload=');
      expect(svg).not.toContain('evil.test');
    }
  });

  it('escapes XML and caps label and every status message at 64 code points', async () => {
    stubView();
    const svg = await (
      await get('/api/badge.svg?id=demo_example&label=%3Cscript%3E%26%22%27&up=%3Csvg%3E')
    ).text();
    expect(svg).toContain('&lt;script&gt;&amp;&quot;&apos;');
    expect(svg).toContain('&lt;svg&gt;');
    expect(svg).not.toContain('<script>');
    for (const status of ['up', 'down', 'degraded']) {
      forgetCachedView();
      workerConfig.monitors = originalMonitors.map((m) =>
        m.id === 'demo_example' ? { ...m, maxLatencyMs: 10 } : m,
      );
      stubView(status === 'down' ? 'down' : 'up', {
        latest: { ping: status === 'degraded' ? 100 : 1, loc: 'HEL', time: T },
      });
      const long = encodeURIComponent('😀'.repeat(70));
      const capped = await (
        await get(`/api/badge.svg?id=demo_example&label=${long}&${status}=${long}`)
      ).text();
      expect(capped).toContain('😀'.repeat(64));
      expect(capped).not.toContain('😀'.repeat(65));
    }
  });

  it('keeps private and missing monitors out and preserves failure statuses', async () => {
    stubView();
    workerConfig.monitors = originalMonitors.map((m) => ({ ...m, private: true }));
    expect((await get()).status).toBe(404);
    expect((await get('/api/badge.svg')).status).toBe(400);
    workerConfig.monitors = originalMonitors;
    forgetCachedView();
    stubView('up', { startedAt: undefined });
    expect((await get()).status).toBe(404);
    forgetCachedView();
    vi.stubGlobal('__env__', {});
    const unavailable = await get();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).toContain('>unavailable</text>');
  });
});
