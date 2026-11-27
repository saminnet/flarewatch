/**
 * Copy this to public.ts and customize. Read on the server by the status page
 * and monitor Workers; do not import `@flarewatch/config` in browser code
 * because `group` can name private monitors.
 */

import type { PageConfig } from '@flarewatch/shared';

export const pageConfig: PageConfig = {
  // Page title (appears in browser tab and header)
  title: 'FlareWatch Demo',

  // Optional: display timestamps in this IANA zone. UTC days and date-entry controls stay in UTC.
  // timezone: 'Europe/Stockholm',

  // Optional: 'private' shows visitors only the sign-in page (needs a password or a provider to sign in).
  // visibility: 'private',

  // Optional: restrict CORS for public API endpoints (e.g. GET /api/data, POST /mcp);
  // omitted allows any origin (CORS: "*").
  // apiCorsOrigins: ['https://status.example.com'],

  // Optional: email subscribers for published monitor incidents (see docs/status-page.md#email-subscribers).
  // subscribers: {
  //   from: 'Status <status@example.com>',
  //   // provider: 'resend', // default; set 'cloudflare' for Cloudflare Email Service (Workers Paid)
  //   dailySendCap: 90,
  //   maxSubscribers: 45,
  // },

  // Footer links (optional)
  links: [
    { label: 'GitHub', link: 'https://github.com/your-org/your-repo' },
    { label: 'Cloudflare', link: 'https://www.cloudflare.com/' },
  ],

  // Optional: group monitors by category; omitted shows a flat list.
  group: {
    Demo: ['demo_example', 'demo_cloudflare_trace'],
    // The group the acme audience in access.example.ts signs in to.
    Acme: ['demo_cloudflare_status'],
  },
};
