import { serve } from '@hono/node-server';
import { createLogger } from '@flarewatch/shared';
import { createProxy } from '../index';

const DEFAULT_PORT = 3000;

const log = createLogger('Proxy');

const port = Number(process.env['PORT']) || DEFAULT_PORT;
const authToken = process.env['FLAREWATCH_PROXY_TOKEN'];
const location = process.env['FLAREWATCH_PROXY_LOCATION'];

const app = createProxy({ authToken, location });

log.info('Starting', {
  port,
  auth: authToken ? 'enabled' : 'disabled',
  location: location ?? 'auto-detect',
});

serve({
  fetch: app.fetch,
  port,
});
