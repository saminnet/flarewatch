/**
 * Example Public Configuration
 * Copy this to public.ts and customize for your needs.
 * Safe to import in browser bundles (status page UI).
 */

import type { PageConfig } from '@flarewatch/shared';

export const pageConfig: PageConfig = {
  // Page title (appears in browser tab and header)
  title: 'FlareWatch Demo',

  // Optional: restrict CORS for public API endpoints (e.g. GET /api/data)
  // If omitted, the API is accessible from any origin (CORS: "*").
  // apiCorsOrigins: ['https://status.example.com'],

  // Header links (optional)
  links: [
    { label: 'GitHub', link: 'https://github.com/your-org/your-repo' },
    { label: 'Cloudflare', link: 'https://www.cloudflare.com/' },
  ],

  // Group monitors by category (optional)
  // If not specified, all monitors are shown in a flat list
  group: {
    Demo: ['demo_example', 'demo_cloudflare_trace', 'demo_cloudflare_status'],
  },
};
