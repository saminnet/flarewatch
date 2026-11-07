import { subscriberToken } from '../subscriber-tokens';

import type { SubscriberMessage } from './subscriber-sender';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function subscriberMail(
  from: string,
  origin: string,
  secret: string,
  email: string,
  event: {
    kind: string;
    name?: string | undefined;
    start?: number | undefined;
    at?: number | undefined;
    generation?: string | undefined;
  },
): Promise<SubscriberMessage> {
  const unsubscribe = new URL('/subscribe/unsubscribe', origin);
  unsubscribe.searchParams.set('token', await subscriberToken(secret, 'unsubscribe', email));
  let subject: string;
  let lines: string[];
  if (event.kind === 'confirm') {
    const confirm = new URL('/subscribe/confirm', origin);
    confirm.searchParams.set(
      'token',
      await subscriberToken(secret, 'confirm', email, event.generation),
    );
    subject = 'Confirm your status page subscription';
    lines = [
      'Confirm your email to receive incident updates.',
      confirm.href,
      'This link expires after 24 hours. If you did not request this, ignore this email.',
    ];
  } else {
    const recovered = event.kind === 'recovered';
    subject = `${event.name ?? 'Monitor'} is ${recovered ? 'up' : 'down'}`.replace(/[\r\n]/g, ' ');
    lines = [subject, `Started: ${new Date((event.start ?? 0) * 1000).toISOString()}`];
    if (recovered)
      lines.push(`Downtime: ${Math.ceil(((event.at ?? 0) - (event.start ?? 0)) / 60)} minutes`);
    lines.push(`Status page: ${new URL('/', origin).href}`);
  }
  lines.push(`Unsubscribe: ${unsubscribe.href}`);
  return {
    from,
    to: [email],
    subject,
    text: lines.join('\n\n'),
    html: lines
      .map((line) => {
        const url = line.match(/https:\/\/\S+/)?.[0];
        return url
          ? `<p>${escapeHtml(line.slice(0, line.indexOf(url)))}<a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`
          : `<p>${escapeHtml(line)}</p>`;
      })
      .join(''),
    headers: {
      'List-Unsubscribe': `<${unsubscribe.href}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
