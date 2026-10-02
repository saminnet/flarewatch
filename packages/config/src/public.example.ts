/**
 * Copy this to public.ts and customize. Safe to import in browser bundles
 * (status page UI).
 */

import type { PageConfig } from '@flarewatch/shared';

export const pageConfig: PageConfig = {
  // Page title (appears in browser tab and header)
  title: 'FlareWatch Demo',

  // Optional: 'private' shows visitors only the sign-in page (needs a password or a provider to sign in).
  // visibility: 'private',

  // Optional: restrict CORS for public API endpoints (e.g. GET /api/data);
  // omitted allows any origin (CORS: "*").
  // apiCorsOrigins: ['https://status.example.com'],

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
