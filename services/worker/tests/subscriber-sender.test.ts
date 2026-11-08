import { expect, it, vi } from 'vite-plus/test';
import { resendSender } from '../src/notifications/subscriber-sender';

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
