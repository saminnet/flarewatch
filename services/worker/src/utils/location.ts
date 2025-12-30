const CF_TRACE_URL = 'https://cloudflare.com/cdn-cgi/trace';

// Module-level cache for the edge location
let cachedLocation: string | null = null;

/**
 * Parse Cloudflare trace response to extract colo (data center code)
 */
function parseTraceResponse(text: string): string | null {
  const match = text.match(/^colo=(.+)$/m);
  return match?.[1] ?? null;
}

/**
 * Get the current Cloudflare edge location (3-letter airport code)
 * Result is cached for the lifetime of the worker instance
 */
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
