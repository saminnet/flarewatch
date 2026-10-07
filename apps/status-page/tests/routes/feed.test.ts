// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { pageConfig } from '@flarewatch/config';
import { workerConfig } from '@flarewatch/config/worker';
import type { HubView } from '@flarewatch/shared';
import { readVisitorSnapshot, forgetCachedView } from '@/lib/snapshots';
import { Route } from '@/routes/feed[.]atom';

const originalMonitors = workerConfig.monitors;
const originalTitle = pageConfig.title;
const T = 1736942400;
afterEach(() => {
  workerConfig.monitors = originalMonitors;
  pageConfig.title = originalTitle;
  vi.unstubAllGlobals();
  forgetCachedView();
});

function fixture(): HubView {
  workerConfig.monitors = [
    { id: 'public', name: '<API> & "service"', method: 'GET', target: 'https://public.test' },
    {
      id: 'private',
      name: 'PRIVATE MONITOR',
      method: 'GET',
      target: 'https://private.test',
      private: true,
    },
  ];
  pageConfig.title = '<Status> & "feed"';
  return {
    lastUpdate: T,
    monitors: {
      public: {
        status: 'down',
        startedAt: T - 100,
        incidents: [{ start: [T - 60], error: ['<error> & "details"\u0000'] }],
      },
      private: {
        status: 'down',
        startedAt: T - 100,
        incidents: [{ start: [T - 50], error: ['PRIVATE INCIDENT'] }],
      },
    },
    maintenances: [
      {
        id: 'maint_public',
        title: '<Maintenance>',
        body: '<Work> & details',
        start: '2025-01-15T12:00:00.000Z',
        createdAt: 1736940000000,
        updatedAt: 1736942400000,
        monitors: ['public', 'private'],
      },
      {
        id: 'maint_private',
        title: 'PRIVATE WINDOW',
        body: 'PRIVATE DETAILS',
        start: '2025-01-15T12:00:00.000Z',
        createdAt: 1736940000000,
        updatedAt: 1736942400000,
        monitors: ['private'],
      },
    ],
    announcements: [
      {
        id: 'ann_1',
        title: '<Notice>',
        body: 'Plain & "quoted" text',
        createdAt: (T - 30) * 1000,
        updatedAt: T * 1000,
      },
    ],
  };
}
function stub(view: HubView) {
  const requests: string[] = [];
  vi.stubGlobal('__env__', {
    MONITOR_WORKER: {
      fetch: async (url: string) => {
        requests.push(url);
        return Response.json(view);
      },
    },
  });
  return requests;
}
type Handler = (ctx: { request: Request }) => Promise<Response>;
async function get() {
  const options = Route.options as { server?: { handlers?: Record<string, Handler> } };
  const handler = options.server?.handlers?.GET;
  if (!handler) throw new Error('Missing Atom GET');
  return handler({ request: new Request('https://status.test/feed.atom') });
}
async function parse() {
  const response = await get();
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('application/atom+xml; charset=utf-8');
  const text = await response.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return { doc, text };
}

describe('GET /feed.atom', () => {
  it('serves valid Atom with escaped public entries and the state update time from one cached view', async () => {
    const requests = stub(fixture());
    await readVisitorSnapshot();
    const { doc, text } = await parse();
    expect(doc.documentElement.namespaceURI).toBe('http://www.w3.org/2005/Atom');
    expect(doc.querySelector('feed > updated')?.textContent).toBe('2025-01-15T12:00:00.000Z');
    expect(doc.querySelector('feed > author > name')?.textContent).toBe('<Status> & "feed"');
    expect([...doc.querySelectorAll('entry > title')].map((e) => e.textContent)).toEqual([
      '<Maintenance>',
      '<Notice>',
      '<API> & "service" incident',
    ]);
    expect(doc.querySelector('entry:last-child > content')?.textContent).toBe(
      '<error> & "details"\uFFFD',
    );
    expect(text).not.toContain('PRIVATE');
    expect(requests).toEqual(['https://internal/view']);
  });

  it('keeps entry ids across edits, rescheduling across years, and incident recovery', async () => {
    const view = fixture();
    stub(view);
    const before = (await parse()).doc;
    view.maintenances[0]!.start = '2026-01-15T12:00:00.000Z';
    view.announcements[0]!.title = 'Edited notice';
    view.announcements[0]!.updatedAt += 60000;
    view.monitors.public!.incidents[0]!.end = T + 60;
    forgetCachedView();
    const after = (await parse()).doc;
    const ids = (doc: Document) =>
      [...doc.querySelectorAll('entry > id')].map((e) => e.textContent).sort();
    expect(ids(after)).toEqual(ids(before));
    expect(new Set(ids(after)).size).toBe(3);
    expect(after.querySelector('entry:last-child > updated')?.textContent).toBe(
      '2025-01-15T12:01:00.000Z',
    );
  });

  it('keeps only the newest 50 entries across all kinds', async () => {
    const view = fixture();
    view.monitors.public!.incidents = Array.from({ length: 60 }, (_, i) => ({
      start: [T - 1000 + i],
      end: T - 999 + i,
      error: [`Incident ${i}`],
    }));
    stub(view);
    const { doc } = await parse();
    const titles = [...doc.querySelectorAll('entry > title')].map((e) => e.textContent);
    expect(titles).toHaveLength(50);
    expect(titles.slice(0, 2)).toEqual(['<Maintenance>', '<Notice>']);
    const content = [...doc.querySelectorAll('entry > content')].map((e) => e.textContent);
    expect(content[2]).toBe('Incident 59');
    expect(content.at(-1)).toBe('Incident 12');
    expect(content).not.toContain('Incident 11');
  });

  it('serves a deterministic empty feed when the hub cannot answer', async () => {
    fixture();
    vi.stubGlobal('__env__', {});
    const { doc } = await parse();
    expect(doc.querySelector('feed > updated')?.textContent).toBe('1970-01-01T00:00:00.000Z');
    expect(doc.querySelectorAll('entry')).toHaveLength(0);
  });
});
