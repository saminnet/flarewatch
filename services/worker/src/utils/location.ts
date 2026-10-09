import { fetchWithTimeout, readTextUpTo, type Fetcher } from '@flarewatch/shared';

const CF_TRACE_URL = 'https://cloudflare.com/cdn-cgi/trace';
const FAILURE_TTL_MS = 60_000;

let cached: { location: Promise<string>; expiresAt: number } | null = null;

/** `colo` is Cloudflare's data-center code, a 3-letter airport code. */
function parseTraceResponse(text: string): string | null {
  const match = text.match(/^colo=(.+)$/m);
  return match?.[1] ?? null;
}

async function readEdgeLocation(fetcher: Fetcher): Promise<{ location: string; ok: boolean }> {
  try {
    const response = await fetcher(CF_TRACE_URL, { timeout: 5000 });
    const location = parseTraceResponse(await readTextUpTo(response, 4096));
    return location ? { location, ok: true } : { location: 'UNKNOWN', ok: false };
  } catch {
    return { location: 'ERROR', ok: false };
  }
}

/**
 * A found location lasts for the worker instance. A failed lookup lasts a
 * minute, so the checks of one run share it and the next run asks again.
 */
export function getEdgeLocation(fetcher: Fetcher = fetchWithTimeout): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.location;
  const location = readEdgeLocation(fetcher).then(({ location, ok }) => {
    if (!ok)
      cached = { location: Promise.resolve(location), expiresAt: Date.now() + FAILURE_TTL_MS };
    return location;
  });
  cached = { location, expiresAt: Infinity };
  return location;
}
