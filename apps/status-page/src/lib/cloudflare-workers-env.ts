import { env } from 'cloudflare:workers';

import type { RuntimeEnv } from './runtime-env';

export function getCloudflareWorkersEnv(): RuntimeEnv | undefined {
  return env as RuntimeEnv | undefined;
}
