import { createLogger, getErrorMessage, withTimeout, type EmailAlert } from '@flarewatch/shared';
import { formatEmailAlert } from './templates/resend';
import { buildTemplateContext, summaryContext, type NotificationContext } from './webhook';

const log = createLogger('AlertEmail');

export const DEFAULT_EMAIL_MARGIN_MS = 5_000;

export type AlertEmailMessage = {
  from: string;
  to: string[];
  subject: string;
  text: string;
};

export type AlertEmailBinding = {
  send(message: AlertEmailMessage): Promise<unknown>;
};

const MISSING_BINDING =
  'ALERT_EMAIL binding is missing: add [[send_email]] name = "ALERT_EMAIL" to services/worker/wrangler.toml';

export async function sendAlertEmail(
  binding: AlertEmailBinding | undefined,
  entry: EmailAlert,
  contexts: NotificationContext[],
  timeoutMs?: number,
): Promise<boolean> {
  if (!binding) {
    log.error(MISSING_BINDING);
    return false;
  }
  const ctx = contexts.length > 1 ? summaryContext(contexts) : contexts[0]!;
  const { subject, text } = formatEmailAlert(buildTemplateContext(ctx));
  try {
    const sending = binding.send({ from: entry.from, to: [entry.to], subject, text });
    await (timeoutMs !== undefined ? withTimeout(sending, timeoutMs) : sending);
    log.info('Sent', { monitors: contexts.length });
    return true;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
    const cause = getErrorMessage(error)
      .replaceAll(entry.to, '<recipient>')
      .replaceAll(entry.from, '<sender>');
    log.error('Error', { ...(code ? { code } : {}), error: cause });
    return false;
  }
}
