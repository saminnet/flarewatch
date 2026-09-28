/**
 * Copy this to worker.ts and customize.
 */

import type { WorkerConfig } from '@flarewatch/shared';

export const workerConfig: WorkerConfig = {
  monitors: [
    // Monitor name links: HTTP/HTTPS targets auto-link by default. Use
    // `link: false` to disable, or `link: 'url'` to override.

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
      responseKeyword: 'colo=',
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

    // TCP port check (runs from the Worker; a proxy is only needed for private networks)
    // {
    //   id: 'database',
    //   name: 'Database',
    //   method: 'TCP_PING',
    //   target: 'db.internal:5432',
    //   checkProxy: 'https://your-proxy.example.com/check',
    //   checkProxyFallback: true, // Optional: try a direct check if the proxy fails
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

    // Behind another monitor: no alert of its own while 'internal-api' is down,
    // and the API's alert lists it under "Also down"
    // {
    //   id: 'reports',
    //   name: 'Reports',
    //   method: 'GET',
    //   target: 'https://reports.internal.example.com/health',
    //   dependsOn: ['internal-api'],
    // },

    // Private monitor (checked and alerted like any other, but hidden from
    // the public page and public API; visible once you sign in)
    // {
    //   id: 'private-database',
    //   name: 'Database (private)',
    //   method: 'TCP_PING',
    //   target: 'db.internal.example.com:5432',
    //   private: true,
    //   checkProxy: 'https://your-proxy.example.com/check',
    // },

    // Scheduled job heartbeat (ping route and token are configured separately)
    // {
    //   id: 'nightly-backup',
    //   name: 'Nightly backup',
    //   method: 'HEARTBEAT',
    //   periodSeconds: 86400,
    //   graceSeconds: 3600,
    // },

    // SSL certificate monitoring (requires a check proxy)
    // {
    //   id: 'ssl-check',
    //   name: 'SSL Certificate',
    //   method: 'GET',
    //   target: 'https://example.com',
    //   sslCheckEnabled: true,
    //   sslCheckDaysBeforeExpiry: 14,
    //   checkProxy: 'https://your-proxy.example.com/check',
    //   checkProxyFallback: true, // Optional: try a direct check if the proxy fails
    // },
  ],

  // Notifications (optional)
  // Never commit real webhook URLs/tokens into a public repo. Put them in the
  // FLAREWATCH_WEBHOOKS secret instead: see docs/alerts.md.
  //
  // notification: {
  //   // Single webhook (templates)
  //   webhook: {
  //     url: 'https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>',
  //     template: 'telegram', // 'slack', 'discord', 'telegram', 'ntfy', or 'text'
  //   },
  //
  //   // Multiple webhooks
  //   // webhook: [
  //   //   { url: 'https://hooks.slack.com/services/...', template: 'slack' },
  //   //   { url: 'https://discord.com/api/webhooks/...', template: 'discord' },
  //   //   // ntfy: on the public ntfy.sh server the topic name is the only secret,
  //   //   // so use a long random topic. Self-hosted servers with auth work too:
  //   //   // add an Authorization header via `headers`.
  //   //   { url: 'https://ntfy.sh/<long-random-topic>', template: 'ntfy' },
  //   // ],
  //
  //   // Custom webhook with $MSG placeholder
  //   // webhook: {
  //   //   url: 'https://example.com/webhook',
  //   //   payloadType: 'json',
  //   //   payload: { message: '$MSG', channel: '#alerts' },
  //   // },
  //
  //   timeZone: 'UTC',
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
