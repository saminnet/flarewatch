export type RuntimeEnv = {
  FLAREWATCH_STATE?: KVNamespace;
  FLAREWATCH_STATUS_PAGE_BASIC_AUTH?: string;
  FLAREWATCH_ADMIN_BASIC_AUTH?: string;
};

/**
 * Resolves the runtime environment for both Cloudflare Workers and Node.js
 */
export async function resolveRuntimeEnv(): Promise<RuntimeEnv | undefined> {
  try {
    const mod = await import('cloudflare:workers');
    const workers = (mod as unknown as { default?: unknown }).default ?? mod;
    const env = (workers as { env?: RuntimeEnv } | undefined)?.env;
    if (env) return env;
  } catch {
    // Ignore - likely not running in the Workers runtime.
  }

  const env =
    (globalThis as { __env__?: unknown; process?: { env?: unknown } }).__env__ ??
    globalThis.process?.env;
  return env as RuntimeEnv | undefined;
}

/**
 * Gets the KV namespace or throws if not available
 */
export async function requireKv(): Promise<KVNamespace> {
  const env = await resolveRuntimeEnv();
  const kv = env?.FLAREWATCH_STATE;
  if (!kv) throw new Error('FLAREWATCH_STATE KV binding not found');
  return kv;
}
