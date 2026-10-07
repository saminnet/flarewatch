import * as z from 'zod/mini';
import {
  type CheckResult,
  type Fetcher,
  type MonitorTarget,
  type RunBudget,
  DEFAULT_HTTP_TIMEOUT,
  MAX_BODY_BYTES,
  readJsonUpTo,
  failure,
  getErrorMessage,
} from '@flarewatch/shared';

const bootstrapSchema = z.object({
  services: z.array(z.tuple([z.array(z.string()), z.array(z.string())])),
});
const domainSchema = z.object({
  objectClassName: z.literal('domain'),
  ldhName: z.string(),
  events: z.array(z.object({ eventAction: z.string(), eventDate: z.string() })),
});
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export async function checkDomain(
  target: MonitorTarget,
  budget: RunBudget,
  fetcher: Fetcher,
): Promise<CheckResult> {
  const start = performance.now();
  const latency = () => Math.round(performance.now() - start);
  const request = (url: string) => {
    if (budget.deadline <= Date.now()) throw new Error('No run time left for RDAP lookup');
    return fetcher(url, {
      headers: { accept: 'application/rdap+json, application/json' },
      timeout: Math.max(
        1,
        Math.min(target.timeout ?? DEFAULT_HTTP_TIMEOUT, budget.deadline - Date.now()),
      ),
      redirect: 'manual',
    });
  };
  try {
    const domain = target.target.toLowerCase();
    const tld = domain.split('.').pop()!;
    const bootstrapResponse = await request('https://data.iana.org/rdap/dns.json');
    if (!bootstrapResponse.ok)
      return failure(`RDAP bootstrap HTTP ${bootstrapResponse.status}`, latency());
    const bootstrap = bootstrapSchema.safeParse(
      await readJsonUpTo(bootstrapResponse, MAX_BODY_BYTES),
    );
    if (!bootstrap.success) return failure('Invalid RDAP bootstrap response', latency());
    const servers = bootstrap.data.services.find(([tlds]) => tlds.includes(tld))?.[1] ?? [];
    const server =
      servers.find((url) => URL.parse(url)?.protocol === 'https:') ??
      servers.find((url) => URL.parse(url)?.protocol === 'http:');
    if (!server) return failure(`No RDAP service for TLD ${tld}`, latency());
    let url = new URL(
      `domain/${encodeURIComponent(domain)}`,
      server.endsWith('/') ? server : `${server}/`,
    );
    let response = await request(url.toString());
    for (let redirects = 0; REDIRECTS.has(response.status); redirects++) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      const next = location ? URL.parse(location, url.toString()) : null;
      if (!next || !['https:', 'http:'].includes(next.protocol) || next.username || next.password)
        return failure('Invalid RDAP redirect', latency());
      if (redirects >= 20) return failure('Too many RDAP redirects', latency());
      if (budget.subrequests < 1 || budget.deadline <= Date.now())
        return failure('No run budget left for RDAP redirect', latency());
      budget.subrequests--;
      url = next;
      response = await request(url.toString());
    }
    if (!response.ok) return failure(`RDAP lookup HTTP ${response.status}`, latency());
    const rdap = domainSchema.safeParse(await readJsonUpTo(response, MAX_BODY_BYTES));
    if (!rdap.success) return failure('Invalid RDAP response', latency());
    if (rdap.data.ldhName.toLowerCase() !== domain)
      return failure(
        'RDAP target must be the registrable domain returned by the service',
        latency(),
      );
    const event = rdap.data.events.find(({ eventAction }) => eventAction === 'expiration');
    if (!event) return failure('No expiration event in RDAP response', latency());
    const expiryDate = Math.floor(Date.parse(event.eventDate) / 1000);
    if (!Number.isFinite(expiryDate))
      return failure('Invalid expiration date in RDAP response', latency());
    const now = Math.floor(Date.now() / 1000);
    const days = Math.floor((expiryDate - now) / 86400);
    const date = new Date(expiryDate * 1000).toISOString().slice(0, 10);
    if (expiryDate <= now) return failure(`Domain expired on ${date}`, latency());
    return {
      ok: true,
      latency: latency(),
      ...(days <= (target.domainExpiryDays ?? 30) && {
        warning: { text: `Domain expires on ${date} (${days} days remaining)`, expiryDate },
      }),
    };
  } catch (error) {
    return failure(`RDAP lookup failed: ${getErrorMessage(error)}`, latency());
  }
}
