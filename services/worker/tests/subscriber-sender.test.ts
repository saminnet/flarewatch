import { expect, it, vi } from 'vite-plus/test';
import {
  cloudflareSender,
  resendSender,
  SubscriberSendError,
} from '../src/notifications/subscriber-sender';

it('cancels each request timeout after success and HTTP failure', async () => {
  vi.useFakeTimers();
  const network = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: [] }))
    .mockResolvedValueOnce(Response.json({ name: 'validation_error' }, { status: 400 }));
  const sender = resendSender('private-key', network);
  await sender.send([], 'first');
  expect(vi.getTimerCount()).toBe(0);
  await expect(sender.send([], 'second')).rejects.toThrow('400 (validation_error)');
  expect(vi.getTimerCount()).toBe(0);
});

it('times out a stalled request and keeps the URL visible', async () => {
  vi.useFakeTimers();
  const network = vi.fn<typeof fetch>(
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), {
          once: true,
        });
      }),
  );
  const pending = resendSender('private-key', network).send([], 'first');
  const rejection = expect(pending).rejects.toThrow(
    'https://api.resend.com/emails/batch: Error: request aborted',
  );
  await vi.advanceTimersByTimeAsync(20_000);
  await rejection;
  expect(vi.getTimerCount()).toBe(0);
});

it('redacts a key echoed in a network error while keeping the URL and cause', async () => {
  const network = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error('connect failed with private-key'));
  await expect(resendSender('private-key', network).send([], 'first')).rejects.toThrow(
    'https://api.resend.com/emails/batch: Error: connect failed with [redacted]',
  );
});

it('maps Cloudflare E_DAILY_LIMIT_EXCEEDED to a next-day SubscriberSendError', async () => {
  const err = Object.assign(new Error('daily quota reached'), { code: 'E_DAILY_LIMIT_EXCEEDED' });
  const sender = cloudflareSender({ send: vi.fn().mockRejectedValue(err) });
  const caught: unknown = await sender
    .send(
      [
        {
          from: 'status@example.com',
          to: ['a@example.com'],
          subject: 'Hi',
          text: 'Hi',
          html: '<p>Hi</p>',
          headers: {},
        },
      ],
      'k',
    )
    .catch((error: unknown) => error);
  expect(caught).toBeInstanceOf(SubscriberSendError);
  if (caught instanceof SubscriberSendError) {
    expect(caught.action).toBe('next day');
    expect(caught.message).toContain('E_DAILY_LIMIT_EXCEEDED');
  }
});

it('redacts recipient addresses echoed in Cloudflare send errors while keeping code and cause', async () => {
  const err = Object.assign(new Error('recipient a@example.com is suppressed'), {
    code: 'E_RECIPIENT_SUPPRESSED',
  });
  const sender = cloudflareSender({ send: vi.fn().mockRejectedValue(err) });
  await expect(
    sender.send(
      [
        {
          from: 'status@example.com',
          to: ['a@example.com'],
          subject: 'Hi',
          text: 'Hi',
          html: '<p>Hi</p>',
          headers: {},
        },
      ],
      'k',
    ),
  ).rejects.toThrow('E_RECIPIENT_SUPPRESSED: Error: recipient [redacted] is suppressed');
});
