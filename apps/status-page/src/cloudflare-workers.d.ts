declare namespace Cloudflare {
  interface Env {
    FLAREWATCH_STATE?: KVNamespace;
    FLAREWATCH_ADMIN_BASIC_AUTH?: string;
    /** Signs the short-lived cookie that carries a provider sign-in. */
    FLAREWATCH_AUTH_SECRET?: string;
    /** JSON object of each provider's client secret, keyed by provider id. */
    FLAREWATCH_OIDC_SECRETS?: string;
    MONITOR_WORKER?: Fetcher;
    /** Sign-in attempts per client IP; see wrangler.jsonc. */
    LOGIN_RATE_LIMIT?: RateLimit;
  }
}

declare module 'cloudflare:workers' {
  const workers: { env: Cloudflare.Env };
  export default workers;
}
