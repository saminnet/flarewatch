import { serve } from '@hono/node-server';
import { createProxy } from '../index';

const port = Number(process.env['PORT']) || 3000;
const authToken = process.env['FLAREWATCH_PROXY_TOKEN'];
const location = process.env['FLAREWATCH_PROXY_LOCATION'];

const app = createProxy({ authToken, location });

console.log('');
console.log('='.repeat(50));
console.log('  FlareWatch Proxy');
console.log('='.repeat(50));
console.log(`  Port:           ${port}`);
console.log(`  Authentication: ${authToken ? 'Enabled' : 'Disabled'}`);
console.log(`  Location:       ${location ?? 'Auto-detect'}`);
console.log('='.repeat(50));
console.log('');
console.log('Endpoints:');
console.log(`  GET  http://localhost:${port}/        - Info`);
console.log(`  GET  http://localhost:${port}/health  - Health check`);
console.log(`  POST http://localhost:${port}/check   - Execute check`);
console.log('');

serve({
  fetch: app.fetch,
  port,
});
