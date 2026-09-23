declare namespace Cloudflare {
  interface Env {
    CONFIG_KV?: KVNamespace;
    STATE_KV?: KVNamespace;
    FLAREWATCH_STATE?: KVNamespace;
    FLAREWATCH_STATUS_PAGE_BASIC_AUTH?: string;
    FLAREWATCH_ADMIN_BASIC_AUTH?: string;
    MONITOR_WORKER?: Fetcher;
  }
}

declare module 'cloudflare:workers' {
  const workers: { env: Cloudflare.Env };
  export default workers;
}
