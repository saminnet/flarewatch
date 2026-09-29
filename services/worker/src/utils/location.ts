import { fetchWithTimeout, readTextUpTo, type Fetcher } from '@flarewatch/shared';

const CF_TRACE_URL = 'https://cloudflare.com/cdn-cgi/trace';

let cachedLocation: string | null = null;

/** `colo` is Cloudflare's data-center code, a 3-letter airport code. */
function parseTraceResponse(text: string): string | null {
  const match = text.match(/^colo=(.+)$/m);
  return match?.[1] ?? null;
}

/** Cached for the lifetime of the worker instance. */
export async function getEdgeLocation(fetcher: Fetcher = fetchWithTimeout): Promise<string> {
  if (cachedLocation) {
    return cachedLocation;
  }

  try {
    const response = await fetcher(CF_TRACE_URL, { timeout: 5000 });
    const text = await readTextUpTo(response, 4096);
    const location = parseTraceResponse(text);

    if (location) {
      cachedLocation = location;
      return location;
    }

    return 'UNKNOWN';
  } catch {
    return 'ERROR';
  }
}
