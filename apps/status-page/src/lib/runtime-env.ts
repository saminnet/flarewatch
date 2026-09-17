export type RuntimeEnv = {
  CONFIG_KV?: KVNamespace;
  STATE_KV?: KVNamespace;
  FLAREWATCH_STATE?: KVNamespace;
  FLAREWATCH_STATUS_PAGE_BASIC_AUTH?: string;
  FLAREWATCH_ADMIN_BASIC_AUTH?: string;
  MONITOR_WORKER?: Fetcher;
};

/**
 * Resolves the runtime environment for both Cloudflare Workers and Node.js
 */
export async function resolveRuntimeEnv(): Promise<RuntimeEnv | undefined> {
  if (import.meta.env.SSR) {
    try {
      const { getCloudflareWorkersEnv } = await import('./cloudflare-workers-env');
      const env = getCloudflareWorkersEnv();
      if (env) return env;
    } catch {
      // Ignore - likely not running in the Workers runtime.
    }
  }

  const globalScope: object = globalThis;
  const env = '__env__' in globalScope ? globalScope.__env__ : globalThis.process?.env;
  // SAFETY: bindings come from the Workers runtime or the test harness __env__ shim;
  // consumers null-check each binding where they use it.
  return env as RuntimeEnv | undefined;
}

/**
 * Gets the KV namespace or throws if not available
 */
export async function requireStateKv(): Promise<KVNamespace> {
  const env = await resolveRuntimeEnv();
  const kv = env?.STATE_KV ?? env?.FLAREWATCH_STATE;
  if (!kv) throw new Error('STATE_KV (or FLAREWATCH_STATE) binding not found');
  return kv;
}
