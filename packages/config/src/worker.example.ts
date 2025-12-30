/**
 * Example Worker Configuration
 * Copy this to worker.ts and customize for your needs.
 */

import type { WorkerConfig } from '@flarewatch/shared';

export const workerConfig: WorkerConfig = {
  monitors: [
    // Monitor name links: HTTP/HTTPS targets auto-link by default.
    // Use `link: false` to disable, or `link: 'url'` to override.

    // Safe demo monitors (no secrets required)
    {
      id: 'demo_example',
      name: 'Example Domain (demo)',
      method: 'GET',
      target: 'https://example.com',
      expectedCodes: [200],
      responseKeyword: 'Example Domain',
      timeout: 10000,
    },

    {
      id: 'demo_cloudflare_trace',
      name: 'Cloudflare Trace (demo)',
      method: 'GET',
      target: 'https://cloudflare.com/cdn-cgi/trace',
      expectedCodes: [200],
      responseKeyword: 'colo=', // Response must contain this
      timeout: 10000,
    },

    {
      id: 'demo_cloudflare_status',
      name: 'Cloudflare Status API (demo)',
      method: 'GET',
      target: 'https://www.cloudflarestatus.com/api/v2/status.json',
      expectedCodes: [200],
      responseKeyword: '"status"',
      timeout: 10000,
    },

    // GlobalPing checks (distributed probes worldwide)
    // Requires a token from https://www.jsdelivr.com/globalping
    // Treat the token as a secret and do not commit it to git.
    // Format: globalping://TOKEN?magic=LOCATION&ipVersion=4
    //
    // {
    //   id: 'global-check',
    //   name: 'Global Check',
    //   method: 'GET',
    //   target: 'https://example.com',
    //   checkProxy: 'globalping://YOUR_GLOBALPING_TOKEN?magic=fra&ipVersion=4',
    // },

    // TCP port check (requires a self-hosted proxy)
    // {
    //   id: 'database',
    //   name: 'Database',
    //   method: 'TCP_PING',
    //   target: 'db.internal:5432',
    //   checkProxy: 'https://your-proxy.example.com/check',
    //   link: 'https://status.example.com/database', // Custom link for non-HTTP targets
    // },

    // Internal service (disable public link)
    // {
    //   id: 'internal-api',
    //   name: 'Internal API',
    //   method: 'GET',
    //   target: 'https://api.internal.example.com/health',
    //   link: false, // Don't expose internal URL to status page visitors
    // },

    // SSL certificate monitoring (requires self-hosted proxy)
    // {
    //   id: 'ssl-check',
    //   name: 'SSL Certificate',
    //   method: 'GET',
    //   target: 'https://example.com',
    //   sslCheckEnabled: true,
    //   sslCheckDaysBeforeExpiry: 14,
    //   checkProxy: 'https://your-proxy.example.com/check',
    // },
  ],

  // Notifications (optional)
  // Never commit real webhook URLs/tokens into a public repo.
  //
  // notification: {
  //   // Single webhook (templates)
  //   webhook: {
  //     url: 'https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>',
  //     template: 'telegram', // 'slack', 'discord', 'telegram', or 'text'
  //   },
  //
  //   // Multiple webhooks
  //   // webhook: [
  //   //   { url: 'https://hooks.slack.com/services/...', template: 'slack' },
  //   //   { url: 'https://discord.com/api/webhooks/...', template: 'discord' },
  //   // ],
  //
  //   // Custom webhook with $MSG placeholder
  //   // webhook: {
  //   //   url: 'https://example.com/webhook',
  //   //   payloadType: 'json',
  //   //   payload: { message: '$MSG', channel: '#alerts' },
  //   // },
  //
  //   timeZone: 'UTC', // For timestamp formatting
  //   gracePeriod: 3, // Minutes before sending notification (avoid flapping)
  // },

  // Callbacks (optional, for advanced use)
  // callbacks: {
  //   onStatusChange: async (env, monitor, isUp, timeIncidentStart, timeNow, reason) => {
  //     console.log({ env, monitor: monitor.id, isUp, timeIncidentStart, timeNow, reason });
  //   },
  //   onIncident: async (env, monitor, timeIncidentStart, timeNow, reason) => {
  //     console.log({ env, monitor: monitor.id, timeIncidentStart, timeNow, reason });
  //   },
  // },
};
