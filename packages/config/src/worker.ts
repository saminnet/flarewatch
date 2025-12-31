import type { WorkerConfig } from '@flarewatch/shared';

export const workerConfig: WorkerConfig = {
  /**
   * Demo monitors (safe defaults)
   *
   * These exist so a fresh fork/template deploy shows a working status page
   * without requiring any secrets.
   *
   * Replace these with your own services before relying on FlareWatch for real
   * alerting/monitoring.
   */
  monitors: [
    {
      id: 'demo_example',
      name: 'Example Domain (demo)',
      method: 'GET',
      target: 'https://example.com',
      expectedCodes: [200],
      responseKeyword: 'Example Domain',
      timeout: 10000,
      link: false,
    },
    {
      id: 'demo_cloudflare_trace',
      name: 'Cloudflare Trace (demo)',
      method: 'GET',
      target: 'https://cloudflare.com/cdn-cgi/trace',
      expectedCodes: [200],
      responseKeyword: 'colo=',
      timeout: 10000,
      link: false,
    },
    {
      id: 'demo_cloudflare_status',
      name: 'Cloudflare Status API (demo)',
      method: 'GET',
      target: 'https://www.cloudflarestatus.com/api/v2/status.json',
      expectedCodes: [200],
      responseKeyword: '"status"',
      timeout: 10000,
      link: 'https://www.cloudflarestatus.com', // Links to status page, not the API endpoint
    },
  ],
};
