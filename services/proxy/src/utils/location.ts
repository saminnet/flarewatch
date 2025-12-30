import { createLogger } from '@flarewatch/shared';

const log = createLogger('Location');

const CF_TRACE_URL = 'https://cloudflare.com/cdn-cgi/trace';
const IP_API_URL = 'https://ipapi.co/json/';

/** Cached location to avoid repeated lookups */
let cachedLocation: string | null = null;

/**
 * Get the location of this proxy instance
 * Tries Cloudflare trace first (works on CF Workers), then falls back to IP geolocation
 */
export async function getLocation(): Promise<string> {
  if (cachedLocation) {
    return cachedLocation;
  }

  // Try Cloudflare trace first (works on CF Workers and when behind CF)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(CF_TRACE_URL, { signal: controller.signal });
    clearTimeout(timeoutId);

    const text = await res.text();
    const match = text.match(/^colo=(.+)$/m);
    if (match?.[1]) {
      cachedLocation = match[1];
      log.info('Detected via CF trace', { location: cachedLocation });
      return cachedLocation;
    }
  } catch {
    // Fall through to IP API
  }

  // Fallback to IP geolocation API
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(IP_API_URL, { signal: controller.signal });
    clearTimeout(timeoutId);

    const data = (await res.json()) as { city?: string; country_code?: string };
    if (data.city && data.country_code) {
      cachedLocation = `${data.city}, ${data.country_code}`;
      log.info('Detected via IP API', { location: cachedLocation });
      return cachedLocation;
    }
  } catch {
    // Fall through to unknown
  }

  cachedLocation = 'UNKNOWN';
  log.info('Could not detect location');
  return cachedLocation;
}

/**
 * Set a custom location (for manual override via env var)
 */
export function setLocation(location: string): void {
  cachedLocation = location;
  log.info('Manually set', { location });
}
