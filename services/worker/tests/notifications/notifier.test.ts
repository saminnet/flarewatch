import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MonitorTarget } from '@flarewatch/shared';

const fetchWithTimeoutMock = vi.fn();

vi.mock('@flarewatch/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@flarewatch/shared')>();
  return {
    ...actual,
    fetchWithTimeout: fetchWithTimeoutMock,
  };
});

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
    fetchWithTimeoutMock.mockReset();
  });

  it('sends custom JSON payload and replaces $MSG placeholders', async () => {
    fetchWithTimeoutMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const { WebhookNotifier } = await import('../../src/notifications/webhook');

    const notifier = new WebhookNotifier({
      url: 'https://hooks.example.com/webhook',
      payloadType: 'json',
      payload: { text: '$MSG', nested: { arr: ['$MSG'] } },
    });

    const results = await notifier.send(createNotificationContext(), 'hello');

    expect(results).toEqual([{ success: true, statusCode: 200 }]);
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchWithTimeoutMock.mock.calls[0] ?? [];
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
    fetchWithTimeoutMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const { WebhookNotifier } = await import('../../src/notifications/webhook');

    const notifier = new WebhookNotifier({
      url: 'https://hooks.example.com/webhook',
      payloadType: 'param',
      payload: { message: '$MSG', channel: '#alerts' },
    });

    await notifier.send(createNotificationContext(), 'hello');

    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1);
    const [calledUrl, options] = fetchWithTimeoutMock.mock.calls[0] ?? [];

    const url = new URL(calledUrl);
    expect(url.searchParams.get('message')).toBe('hello');
    expect(url.searchParams.get('channel')).toBe('#alerts');
    expect(options?.method).toBe('GET');
  });

  it('uses templates when template is configured', async () => {
    fetchWithTimeoutMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const { WebhookNotifier } = await import('../../src/notifications/webhook');

    const notifier = new WebhookNotifier({
      url: 'https://hooks.example.com/webhook',
      template: 'text',
      headers: { 'X-Test': '1' },
    });

    await notifier.send(createNotificationContext(), 'ignored');

    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchWithTimeoutMock.mock.calls[0] ?? [];
    expect(options).toBeDefined();
    if (!options) throw new Error('Expected fetch options to be defined');
    const headers = options.headers as Headers;

    expect(options.method).toBe('POST');
    expect(headers.get('content-type')).toBe('text/plain');
    expect(headers.get('x-test')).toBe('1');
    expect(options.body).toBeTypeOf('string');
  });

  it('returns success=false when webhook responds with non-2xx', async () => {
    fetchWithTimeoutMock.mockResolvedValue(new Response('fail', { status: 500 }));

    const { WebhookNotifier } = await import('../../src/notifications/webhook');

    const notifier = new WebhookNotifier({
      url: 'https://hooks.example.com/webhook',
      payloadType: 'json',
      payload: { text: '$MSG' },
    });

    const results = await notifier.send(createNotificationContext(), 'hello');

    expect(results).toEqual([{ success: false, statusCode: 500, error: 'HTTP 500' }]);
  });
});
