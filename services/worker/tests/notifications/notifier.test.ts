import { describe, it, expect, beforeEach, vi } from 'vite-plus/test';
import type { Fetcher, MonitorTarget } from '@flarewatch/shared';
import { WebhookNotifier } from '../../src/notifications/webhook';

const fetchMock = vi.fn<Fetcher>();

function createMonitor(): MonitorTarget {
  return {
    id: 'test-monitor',
    name: 'Test Monitor',
    method: 'GET',
    target: 'https://example.com',
  };
}

function createNotificationContext() {
  return {
    monitor: createMonitor(),
    isUp: false,
    incidentStartTime: 1000,
    currentTime: 1000,
    reason: 'Connection refused',
    timeZone: 'UTC',
    alsoDown: [],
  };
}

describe('WebhookNotifier', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('keeps the webhook URL out of logs and results when the request throws', async () => {
    const url = 'https://api.telegram.org/bot123:SECRET/sendMessage';
    fetchMock.mockRejectedValue(new TypeError(`fetch failed for ${url}`));
    const logged: unknown[] = [];
    const spies = (['info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((line: unknown) => logged.push(line)),
    );

    const notifier = new WebhookNotifier({ url, payloadType: 'json', payload: {} }, fetchMock);
    const results = await notifier.send(createNotificationContext(), 'hello');
    for (const spy of spies) spy.mockRestore();

    expect(JSON.stringify([logged, results])).not.toContain('SECRET');
    expect(results).toEqual([{ success: false, error: 'fetch failed for <webhook URL>' }]);
  });

  it('sends custom JSON payload and replaces $MSG placeholders', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const notifier = new WebhookNotifier(
      {
        url: 'https://hooks.example.com/webhook',
        payloadType: 'json',
        payload: { text: '$MSG', nested: { arr: ['$MSG'] } },
      },
      fetchMock,
    );

    const results = await notifier.send(createNotificationContext(), 'hello');

    expect(results).toEqual([{ success: true, statusCode: 200 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://hooks.example.com/webhook');
    expect(options).toBeDefined();
    if (!options) throw new Error('Expected fetch options to be defined');

    expect(options.method).toBe('POST');
    expect(options.timeout).toBe(5000);
    expect((options.headers as Headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(options.body as string)).toEqual({
      text: 'hello',
      nested: { arr: ['hello'] },
    });
  });

  it('uses query params when payloadType=param', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const notifier = new WebhookNotifier(
      {
        url: 'https://hooks.example.com/webhook',
        payloadType: 'param',
        payload: { message: '$MSG', channel: '#alerts' },
      },
      fetchMock,
    );

    await notifier.send(createNotificationContext(), 'hello');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, options] = fetchMock.mock.calls[0] ?? [];
    if (calledUrl === undefined) throw new Error('fetch was not called');

    const url = new URL(calledUrl);
    expect(url.searchParams.get('message')).toBe('hello');
    expect(url.searchParams.get('channel')).toBe('#alerts');
    expect(options?.method).toBe('GET');
  });

  it.each([undefined, null, 'text', 42, ['a', 'b']])(
    'fails without sending for param payload %s',
    async (payload) => {
      fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

      const notifier = new WebhookNotifier(
        {
          url: 'https://hooks.example.com/webhook',
          payloadType: 'param',
          ...(payload === undefined ? {} : { payload }),
        },
        fetchMock,
      );

      const result = await notifier.send(createNotificationContext(), 'hello');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toEqual([
        { success: false, error: "Webhook payloadType 'param' needs a payload" },
      ]);
    },
  );

  it('encodes arrays as repeated keys and objects as JSON', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const notifier = new WebhookNotifier(
      {
        url: 'https://hooks.example.com/webhook',
        payloadType: 'x-www-form-urlencoded',
        payload: { channels: ['ops', 'alerts'], meta: { team: 'core' }, note: null, retries: 3 },
      },
      fetchMock,
    );

    await notifier.send(createNotificationContext(), 'hello');

    const [, options] = fetchMock.mock.calls[0] ?? [];
    const body = new URLSearchParams(options?.body as string);
    expect(body.getAll('channels')).toEqual(['ops', 'alerts']);
    expect(body.get('meta')).toBe('{"team":"core"}');
    expect(body.get('note')).toBe('');
    expect(body.get('retries')).toBe('3');
  });

  it('template body carries down state and reason', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const notifier = new WebhookNotifier(
      {
        url: 'https://hooks.example.com/webhook',
        template: 'text',
        headers: { 'X-Test': '1' },
      },
      fetchMock,
    );

    await notifier.send(createNotificationContext(), 'ignored');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] ?? [];
    expect(options).toBeDefined();
    if (!options) throw new Error('Expected fetch options to be defined');
    const headers = options.headers as Headers;

    expect(options.method).toBe('POST');
    expect(headers.get('content-type')).toBe('text/plain');
    expect(headers.get('x-test')).toBe('1');
    expect(options.body).toContain('Test Monitor is down');
    expect(options.body).toContain('Connection refused');
  });

  it('uses the URL and method produced by the matrix template', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const notifier = new WebhookNotifier(
      {
        url: 'https://matrix.example.com/_matrix/client/v3/rooms/!room:example.com/send/m.room.message/?access_token=s3cret',
        template: 'matrix',
      },
      fetchMock,
    );

    await notifier.send(createNotificationContext(), 'ignored');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://matrix.example.com/_matrix/client/v3/rooms/!room:example.com/send/m.room.message/test-monitor%3A1000-down-1970-01-01T00%3A16%3A40.000Z?access_token=s3cret',
    );
    expect(options?.method).toBe('PUT');
  });

  it('keeps the webhook URL and headers out of logs when a failed response echoes them', async () => {
    const url = 'https://hooks.example.com/services/SECRET-PATH';
    fetchMock.mockResolvedValue(
      new Response(`bad request to ${url} with Bearer header-secret-token`, { status: 400 }),
    );
    const logged: unknown[] = [];
    const spies = (['info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((line: unknown) => logged.push(line)),
    );

    const notifier = new WebhookNotifier(
      {
        url,
        headers: { Authorization: 'Bearer header-secret-token' },
        payloadType: 'json',
        payload: {},
      },
      fetchMock,
    );
    await notifier.send(createNotificationContext(), 'hello');
    for (const spy of spies) spy.mockRestore();

    expect(JSON.stringify(logged)).toContain('bad request to');
    expect(JSON.stringify(logged)).not.toContain('SECRET-PATH');
    expect(JSON.stringify(logged)).not.toContain('header-secret-token');
  });

  it('stops reading a failed webhook response that never ends', async () => {
    const chunk = new TextEncoder().encode(' '.repeat(64 * 1024));
    fetchMock.mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(chunk) }), {
        status: 500,
      }),
    );

    const notifier = new WebhookNotifier(
      { url: 'https://hooks.example.com/webhook', payloadType: 'json', payload: {} },
      fetchMock,
    );

    expect(await notifier.send(createNotificationContext(), 'hello')).toEqual([
      { success: false, statusCode: 500, error: 'HTTP 500' },
    ]);
  });

  it('returns success=false when webhook responds with non-2xx', async () => {
    fetchMock.mockResolvedValue(new Response('fail', { status: 500 }));

    const notifier = new WebhookNotifier(
      {
        url: 'https://hooks.example.com/webhook',
        payloadType: 'json',
        payload: { text: '$MSG' },
      },
      fetchMock,
    );

    const results = await notifier.send(createNotificationContext(), 'hello');

    expect(results).toEqual([{ success: false, statusCode: 500, error: 'HTTP 500' }]);
  });

  it('sends the other webhooks when one fails', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response('ok', { status: 200 })));

    const notifier = new WebhookNotifier(
      [
        { url: 'https://hooks.example.com/first' },
        { url: 'https://hooks.example.com/second', template: 'text' },
      ],
      fetchMock,
    );

    const results = await notifier.send(createNotificationContext(), 'hello');

    expect(results).toEqual([
      { success: false, error: 'boom' },
      { success: true, statusCode: 200 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
