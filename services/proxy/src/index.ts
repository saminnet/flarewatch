import { serve } from '@hono/node-server';
import { createProxy } from './app';
import { createLogger } from './log';

const DEFAULT_PORT = 3000;

const log = createLogger('Proxy');

const port = Number(process.env['PORT']) || DEFAULT_PORT;
const authToken = process.env['FLAREWATCH_PROXY_TOKEN'];
const location = process.env['FLAREWATCH_PROXY_LOCATION'];

if (!authToken) {
  log.error('FLAREWATCH_PROXY_TOKEN is required');
  process.exit(1);
}

const app = createProxy({ authToken, location });

log.info('Starting', {
  location: location ?? 'auto-detect',
  port,
});

serve({
  fetch: app.fetch,
  port,
});
