import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { text } from 'node:stream/consumers';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vite-plus/test';
import type { HubView, WorkerConfig } from '@flarewatch/shared';
import { useDirectWorker } from './helpers/direct-worker';
import { close, listen } from './helpers/local-server';

// A whole check run in workerd: real checks, the hub in a SQLite Durable Object, real alerts.
const worker = useDirectWorker();
let origin = '';
let targetStatus = 200;
const alerts: string[] = [];

async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.url === '/hook') {
    alerts.push(await text(request));
    response.writeHead(200).end();
    return;
  }
  response.writeHead(targetStatus).end();
}

const server = createServer((request, response) => void answer(request, response));

beforeAll(async () => {
  origin = `http://127.0.0.1:${await listen(server)}`;
});
afterAll(() => close(server));
beforeEach(() => {
  alerts.length = 0;
  targetStatus = 200;
});

const pull = (id: string) => ({
  id,
  name: id.toUpperCase(),
  method: 'GET' as const,
  target: `${origin}/${id}`,
});

const run = async (hub: string, config: WorkerConfig) =>
  (await worker.post('/run', { hub, config })) as HubView;

it('alerts an outage and its recovery from a check run', async () => {
  const config = {
    monitors: [pull('api')],
    notification: { webhook: { url: `${origin}/hook`, template: 'text' as const } },
  };
  targetStatus = 503;
  expect((await run('outage', config)).monitors.api?.status).toBe('down');
  expect(alerts).toHaveLength(1);
  expect(alerts[0]).toContain('API is down');

  targetStatus = 200;
  expect((await run('outage', config)).monitors.api?.status).toBe('up');
  expect(alerts).toHaveLength(2);
  expect(alerts[1]).toContain('API is up');
});

it('sends a mass outage to each webhook as one summary', async () => {
  const config = {
    monitors: ['a', 'b', 'c'].map(pull),
    notification: {
      webhook: { url: `${origin}/hook`, template: 'text' as const },
      summaryAfter: 2,
    },
  };
  targetStatus = 503;
  const view = await run('summary', config);
  expect(['a', 'b', 'c'].map((id) => view.monitors[id]?.status)).toEqual(['down', 'down', 'down']);
  expect(alerts).toHaveLength(1);
  for (const name of ['A', 'B', 'C']) expect(alerts[0]).toContain(name);
});
