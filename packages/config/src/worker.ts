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
      name: 'Example Domain',
      method: 'GET',
      target: 'https://example.com',
      expectedCodes: [200],
      responseKeyword: 'Example Domain',
      timeout: 10000,
      link: false,
    },
    {
      id: 'demo_cloudflare_trace',
      name: 'Cloudflare Trace',
      method: 'GET',
      target: 'https://cloudflare.com/cdn-cgi/trace',
      expectedCodes: [200],
      responseKeyword: 'colo=',
      timeout: 10000,
      link: false,
    },
    {
      id: 'demo_cloudflare_status',
      name: 'Cloudflare Status API',
      method: 'GET',
      target: 'https://www.cloudflarestatus.com/api/v2/status.json',
      expectedCodes: [200],
      responseKeyword: '"status"',
      timeout: 10000,
      link: 'https://www.cloudflarestatus.com', // Links to status page, not the API endpoint
    },
    {
      id: 'demo_flarewatch_site',
      name: 'flarewatch.app',
      method: 'GET',
      target: 'https://flarewatch.app',
      expectedCodes: [200],
      responseKeyword: 'FlareWatch',
      timeout: 10000,
    },
    {
      id: 'demo_cloudflare_docs',
      name: 'Cloudflare Docs',
      method: 'GET',
      target: 'https://developers.cloudflare.com',
      expectedCodes: [200],
      timeout: 10000,
    },
    {
      id: 'demo_one_dns_trace',
      name: '1.1.1.1 Trace',
      method: 'GET',
      target: 'https://1.1.1.1/cdn-cgi/trace',
      expectedCodes: [200],
      responseKeyword: 'colo=',
      timeout: 10000,
      link: false,
    },
    {
      id: 'demo_github_status',
      name: 'GitHub Status API',
      method: 'GET',
      target: 'https://www.githubstatus.com/api/v2/status.json',
      expectedCodes: [200],
      responseKeyword: '"status"',
      timeout: 10000,
      link: 'https://www.githubstatus.com',
    },
  ],
};
