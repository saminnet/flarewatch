import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import { text } from 'node:stream/consumers';
import { unstable_startWorker } from 'wrangler';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import type { JsonObject } from '@flarewatch/shared';
import fixture from '../fixtures/verdicts.json';

/** flarewatch-proxy runs the same file, so this shape is a contract between the repos. */
interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  bodyBase64?: string;
  echo?: boolean;
  hang?: boolean | string;
  cut?: boolean;
}

interface Verdict {
  ok: boolean;
  error?: string;
}

interface Case {
  name: string;
  replies?: Reply[];
  hops?: number;
  monitor: JsonObject;
  result: Verdict;
}

interface Disagreement {
  result: Verdict;
  cause: string;
}

/**
 * Cases where the direct check gives another result than the proxy. Each entry
 * holds the direct check's result, so a change on either side fails the test.
 */
const DISAGREES = new Map<string, Disagreement>([
  [
    'request headers: the default user agent',
    {
      result: {
        ok: false,
        error:
          'JSON value at $.headers.user-agent is not "FlareWatch-Proxy/1.0 (+https://github.com/saminnet/flarewatch)"',
      },
      cause: 'the direct check sends FlareWatch/1.0, the proxy sends FlareWatch-Proxy/1.0',
    },
  ],
  [
    'credentials: a target URL with a username and password fails',
    {
      result: { ok: true },
      cause:
        'workerd drops the username and password and sends the request; the config rejects this target',
    },
  ],
]);

let worker: Awaited<ReturnType<typeof unstable_startWorker>>;

const HOST = '127.0.0.1';
let tcp = 0;
let closed = 0;

async function listen(listener: net.Server): Promise<number> {
  listener.listen(0, HOST);
  await once(listener, 'listening');
  const address = listener.address();
  if (address === null || typeof address === 'string') throw new Error('listener has no port');
  return address.port;
}

const tcpListener = net.createServer((socket) => socket.destroy());

beforeAll(async () => {
  worker = await unstable_startWorker({
    config: `${import.meta.dirname}/../workerd/direct/wrangler.toml`,
    dev: { server: { port: 0 }, inspector: false },
  });
  tcp = await listen(tcpListener);
  const unused = net.createServer();
  closed = await listen(unused);
  unused.close();
  await once(unused, 'close');
}, 60_000);

afterAll(async () => {
  tcpListener.close();
  await worker.dispose();
});

interface Target {
  origin: string;
  other: string;
}

function expand(value: string, { origin, other }: Target): string {
  const placeholders = {
    '{ORIGIN}': origin.replace('http://', 'HTTP://'),
    '{originhost}': origin.replace('http://', ''),
    '{otherhost}': other.replace('http://', ''),
    '{origin}': origin,
    '{other}': other,
    '{tcphost}': HOST,
    '{tcpport}': String(tcp),
    '{tcp}': `${HOST}:${tcp}`,
    '{closed}': `${HOST}:${closed}`,
  };
  return Object.entries(placeholders).reduce((out, [from, to]) => out.replaceAll(from, to), value);
}

/** The target server of fixture_test.go in flarewatch-proxy: the path is an index into the replies. */
async function answer(
  replies: Reply[],
  target: Target,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const reply = replies[Number(request.url?.slice(1))];
  if (!reply) {
    response.writeHead(404).end();
    return;
  }
  for (const [name, value] of Object.entries(reply.headers ?? {})) {
    response.setHeader(name, expand(value, target));
  }
  response.statusCode = reply.status ?? 200;
  if (reply.hang === true) return;
  if (reply.hang === 'body' || reply.cut) {
    response.setHeader('Content-Length', '1000');
    response.write('partial');
    if (reply.cut) response.destroy();
    return;
  }
  if (reply.echo) {
    const headers = Object.fromEntries(
      Object.entries(request.headers).map(([name, value]) => [name, [value].flat().join(', ')]),
    );
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ method: request.method, headers, body: await text(request) }));
    return;
  }
  response.end(
    reply.bodyBase64 === undefined
      ? (reply.body ?? '')
      : Uint8Array.from(atob(reply.bodyBase64), (char) => char.charCodeAt(0)),
  );
}

describe('verdicts.json through the direct check on workerd', () => {
  it.each(fixture as Case[])('$name', async ({ name, replies, hops, monitor, result }) => {
    const list: Reply[] = hops
      ? [
          ...Array.from({ length: hops }, (_, hop) => ({
            status: 302,
            headers: { Location: `/${hop + 1}` },
          })),
          { body: 'end' },
        ]
      : (replies ?? []);
    const target: Target = { origin: '', other: '' };
    const servers = [0, 1].map(() =>
      createServer((request, response) => void answer(list, target, request, response)),
    );
    const [originPort, otherPort] = await Promise.all(servers.map(listen));
    target.origin = `http://${HOST}:${originPort}`;
    target.other = `http://${HOST}:${otherPort}`;

    try {
      const body = JSON.stringify({
        id: 'test',
        name: 'Test',
        method: 'GET',
        target: '{origin}/0',
        ...monitor,
      });
      const response = await worker.fetch('http://worker/', {
        method: 'POST',
        body: expand(body, target),
      });
      const got: unknown = await response.json();
      const want = DISAGREES.get(name)?.result ?? result;

      expect(got).toMatchObject(want);
      if (!want.ok) expect(got).toHaveProperty('error', expect.stringMatching(/./));
    } finally {
      for (const each of servers) {
        each.close();
        each.closeAllConnections();
      }
    }
  });
});
