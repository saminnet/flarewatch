declare global {
  interface Env {
    CONFIG_KV?: KVNamespace;
    STATE_KV?: KVNamespace;
    FLAREWATCH_STATE?: KVNamespace;
    FLAREWATCH_STATUS_PAGE_BASIC_AUTH?: string;
    FLAREWATCH_ADMIN_BASIC_AUTH?: string;
  }
}

declare module 'cloudflare:workers' {
  const workers: { env: Env };
  export default workers;
}
