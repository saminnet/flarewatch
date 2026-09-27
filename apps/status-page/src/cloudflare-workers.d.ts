declare namespace Cloudflare {
  interface Env {
    FLAREWATCH_STATE?: KVNamespace;
    /** Replaced by statusPage.visibility; while still set, the page stays private-only. */
    FLAREWATCH_STATUS_PAGE_BASIC_AUTH?: string;
    FLAREWATCH_ADMIN_BASIC_AUTH?: string;
    MONITOR_WORKER?: Fetcher;
    /** Sign-in attempts per client IP; see wrangler.jsonc. */
    LOGIN_RATE_LIMIT?: RateLimit;
  }
}

declare module 'cloudflare:workers' {
  const workers: { env: Cloudflare.Env };
  export default workers;
}
