declare global {
  /** Test-harness shim; production bindings come from the Workers runtime. */
  var __env__: Cloudflare.Env | undefined;
}

export async function resolveRuntimeEnv(): Promise<Cloudflare.Env> {
  if (import.meta.env.SSR) {
    try {
      const { env } = await import('cloudflare:workers');
      return env;
    } catch {
      // Ignore - likely not running in the Workers runtime.
    }
  }

  if (globalThis.__env__) return globalThis.__env__;

  // process.env is string-valued, so project only the credentials the app reads from it;
  // KV and service bindings exist solely in the Workers runtime or the test shim.
  const processEnv = globalThis.process?.env;
  const env: Cloudflare.Env = {};
  const adminAuth = processEnv?.FLAREWATCH_ADMIN_BASIC_AUTH;
  if (adminAuth) env.FLAREWATCH_ADMIN_BASIC_AUTH = adminAuth;
  return env;
}

export async function requireStateKv(): Promise<KVNamespace> {
  const env = await resolveRuntimeEnv();
  if (!env.FLAREWATCH_STATE) throw new Error('FLAREWATCH_STATE binding not found');
  return env.FLAREWATCH_STATE;
}
