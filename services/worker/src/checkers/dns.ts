import * as z from 'zod/mini';
import {
  type CheckResult,
  type Fetcher,
  type MonitorTarget,
  DEFAULT_HTTP_TIMEOUT,
  MAX_BODY_BYTES,
  readJsonUpTo,
  success,
  failure,
  getErrorMessage,
} from '@flarewatch/shared';

const RECORD_TYPES = { A: 1, AAAA: 28, CNAME: 5, MX: 15, TXT: 16, NS: 2, CAA: 257 };
const STATUS_NAMES = new Map<number, string>([
  [1, 'FORMERR'],
  [2, 'SERVFAIL'],
  [3, 'NXDOMAIN'],
  [4, 'NOTIMP'],
  [5, 'REFUSED'],
  [6, 'YXDOMAIN'],
  [7, 'YXRRSET'],
  [8, 'NXRRSET'],
  [9, 'NOTAUTH'],
  [10, 'NOTZONE'],
  [11, 'DSOTYPENI'],
  [16, 'BADVERS'],
  [17, 'BADKEY'],
  [18, 'BADTIME'],
  [19, 'BADMODE'],
  [20, 'BADNAME'],
  [21, 'BADALG'],
  [22, 'BADTRUNC'],
  [23, 'BADCOOKIE'],
]);
const replySchema = z.object({
  Status: z.int().check(z.gte(0)),
  Answer: z.optional(z.array(z.object({ type: z.int(), data: z.string() }))),
});

export async function checkDns(target: MonitorTarget, fetcher: Fetcher): Promise<CheckResult> {
  const start = performance.now();
  const latency = () => Math.round(performance.now() - start);
  try {
    const type = target.dnsRecordType ?? 'A';
    const url = new URL(target.dnsResolver ?? 'https://cloudflare-dns.com/dns-query');
    url.searchParams.set('name', target.target);
    url.searchParams.set('type', type);
    const response = await fetcher(url.toString(), {
      headers: { accept: 'application/dns-json' },
      timeout: target.timeout ?? DEFAULT_HTTP_TIMEOUT,
      redirect: 'error',
    });
    if (!response.ok) return failure(`DNS resolver HTTP ${response.status}`, latency());
    const reply = replySchema.safeParse(await readJsonUpTo(response, MAX_BODY_BYTES));
    if (!reply.success) return failure('Invalid DNS response', latency());
    if (reply.data.Status !== 0)
      return failure(
        `DNS status ${STATUS_NAMES.get(reply.data.Status) ?? reply.data.Status}`,
        latency(),
      );
    const values = (reply.data.Answer ?? [])
      .filter((record) => record.type === RECORD_TYPES[type])
      .map((record) => record.data);
    if (values.length === 0) return failure(`No ${type} records in DNS answer`, latency());
    const missing = target.dnsExpected?.find((value) => !values.includes(value));
    if (missing !== undefined) return failure(`Missing expected DNS value: ${missing}`, latency());
    return success(latency());
  } catch (error) {
    return failure(`DNS lookup failed: ${getErrorMessage(error)}`, latency());
  }
}
