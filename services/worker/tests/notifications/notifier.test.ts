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
  };
}

describe('WebhookNotifier', () => {
  beforeEach(() => {
    fetchMock.mockReset();
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
    'reports failure instead of sending an empty body when a param payload is %s',
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

  it('uses templates when template is configured', async () => {
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
    expect(options.body).toBeTypeOf('string');
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
});
