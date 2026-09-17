import { env } from 'cloudflare:workers';

import type { RuntimeEnv } from './runtime-env';

export function getCloudflareWorkersEnv(): RuntimeEnv | undefined {
  // SAFETY: cloudflare:workers injects the bindings declared for this app;
  // consumers null-check each binding where they use it.
  return env as RuntimeEnv | undefined;
}
