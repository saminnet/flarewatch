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
        if (!response.ok)
          throw new Error(`https://api.resend.com/emails/batch answered ${response.status}`);
        const result: unknown = await response.json();
        const accepted = z
          .object({ data: z.array(z.object({ id: z.string() })) })
          .safeParse(result);
        if (!accepted.success || accepted.data.data.length !== messages.length)
          throw new Error(
            'https://api.resend.com/emails/batch returned an invalid acknowledgement',
          );
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
