const CF_TRACE_URL = 'https://cloudflare.com/cdn-cgi/trace';

let cachedLocation: string | null = null;

/** `colo` is Cloudflare's data-center code, a 3-letter airport code. */
function parseTraceResponse(text: string): string | null {
  const match = text.match(/^colo=(.+)$/m);
  return match?.[1] ?? null;
}

/** Cached for the lifetime of the worker instance. */
export async function getEdgeLocation(): Promise<string> {
  if (cachedLocation) {
    return cachedLocation;
  }

  try {
    const response = await fetch(CF_TRACE_URL);
    const text = await response.text();
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
