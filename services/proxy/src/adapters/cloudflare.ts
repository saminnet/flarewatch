import { createProxy } from '../index';

export interface Env {
  /** Optional Bearer token for authentication */
  FLAREWATCH_PROXY_TOKEN?: string;
  /** Optional location override (e.g., "NYC", "London") */
  FLAREWATCH_PROXY_LOCATION?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = createProxy({
      authToken: env.FLAREWATCH_PROXY_TOKEN,
      location: env.FLAREWATCH_PROXY_LOCATION,
    });

    return app.fetch(request);
  },
};
