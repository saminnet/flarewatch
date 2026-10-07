import { isJsonObject } from '@flarewatch/shared';
export type Delivered = {
  id: string;
  label: string;
  startedAt?: number;
  at?: number;
  downtimeSeconds?: number;
  reason?: string;
  alsoDown: string[];
  message: string;
  key: string;
};

export function decodeAlert(url: string, body: unknown): Delivered | undefined {
  let text = typeof body === 'string' ? body : '';
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'string') text = parsed;
    else if (isJsonObject(parsed) && 'msgtype' in parsed && typeof parsed.body === 'string')
      text = parsed.body;
  } catch {}
  const lines = text.split('\n');
  const head = lines[0] ?? '';
  const up = /^✅ (.*) is up!$/.exec(head);
  const down = /^🔴 (.*) is down$/.exec(head);
  const still = /^🔴 (.*) is still down(?: \(reminder (\d+)\))?$/.exec(head);
  if (!up && !down && !still) return undefined;
  const name = (up ?? down ?? still)![1]!;
  const label = up ? 'up' : down ? 'down' : still![2] ? `reminder ${still![2]}` : 'still down';
  const alsoLine = lines.find((line) => line.startsWith('Also down: '));
  const reasonLine = lines.find((line) => line.startsWith('Reason: '));
  const txn = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  const target = /^(.+):(\d+)-(?:up|down)-(.+)$/.exec(txn);
  const startedAt = target ? Number(target[2]) : undefined;
  const at = target ? Date.parse(target[3]!) / 1000 : undefined;
  return {
    id: target ? target[1]! : name[0]!.toLowerCase() + name.slice(1),
    label,
    ...(startedAt !== undefined && { startedAt }),
    ...(at !== undefined && { at }),
    ...(startedAt !== undefined && at !== undefined && { downtimeSeconds: at - startedAt }),
    ...(reasonLine && { reason: reasonLine.slice('Reason: '.length) }),
    alsoDown: alsoLine ? alsoLine.slice('Also down: '.length).split(', ') : [],
    message: text,
    key: target ? txn : text,
  };
}

export function webhookCapture(host: string) {
  const delivered: Delivered[] = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).host === host) {
      const alert = decodeAlert(url, init?.body);
      if (alert) delivered.push(alert);
    }
    return new Response('ok');
  };
  return { delivered, fetchMock };
}
