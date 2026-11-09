import * as z from 'zod/mini';

export const subscriberMessageSchema = z.object({
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  text: z.string(),
  html: z.string(),
  headers: z.record(z.string(), z.string()),
});
export type SubscriberMessage = z.infer<typeof subscriberMessageSchema>;

export type SubscriberSender = {
  maxPerBatch: number;
  send(messages: SubscriberMessage[], key: string): Promise<void>;
};

export type SubscriberEmailBinding = {
  send(message: SubscriberMessage): Promise<unknown>;
};

export class PermanentSubscriberError extends Error {}

export class ResendSubscriberError extends Error {
  constructor(
    message: string,
    readonly action: 'skip batch' | 'next day' | 'retry',
  ) {
    super(message);
  }
}

const resendErrorSchema = z.object({ name: z.string() });

function resendAction(status: number, name: string): ResendSubscriberError['action'] {
  if (status === 400 || status === 422) return 'skip batch';
  if (status === 409 && name === 'invalid_idempotent_request') return 'skip batch';
  if (status === 429 && (name === 'daily_quota_exceeded' || name === 'monthly_quota_exceeded'))
    return 'next day';
  return 'retry';
}

export function resendSender(apiKey: string, fetcher: typeof fetch = fetch): SubscriberSender {
  return {
    maxPerBatch: 100,
    async send(messages, key) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error('Subscriber send timed out')),
        20_000,
      );
      try {
        const response = await fetcher('https://api.resend.com/emails/batch', {
          method: 'POST',
          redirect: 'manual',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body: JSON.stringify(messages),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body: unknown = await response.json().catch(() => undefined);
          const name = (resendErrorSchema.safeParse(body).data?.name ?? 'unknown').replaceAll(
            apiKey,
            '[redacted]',
          );
          const status = response.status;
          throw new ResendSubscriberError(
            `https://api.resend.com/emails/batch answered ${status} (${name})`,
            resendAction(status, name),
          );
        }
        const result: unknown = await response.json();
        const accepted = z
          .object({ data: z.array(z.object({ id: z.string() })) })
          .safeParse(result);
        if (!accepted.success || accepted.data.data.length !== messages.length)
          throw new Error(
            'https://api.resend.com/emails/batch returned an invalid acknowledgement',
          );
      } catch (error) {
        if (error instanceof ResendSubscriberError) throw error;
        const cause = String(error).replaceAll(apiKey, '[redacted]');
        throw new Error(`https://api.resend.com/emails/batch: ${cause}`);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function cloudflareSender(binding: SubscriberEmailBinding): SubscriberSender {
  return {
    maxPerBatch: 10,
    async send(messages) {
      for (const message of messages) {
        try {
          await binding.send(message);
        } catch (error) {
          const code = error instanceof Error && 'code' in error ? String(error.code) : '';
          if (code === 'E_SENDER_NOT_VERIFIED' || code === 'E_SENDER_DOMAIN_NOT_AVAILABLE')
            throw new PermanentSubscriberError(`${code}: ${String(error)}`);
          throw error;
        }
      }
    },
  };
}
