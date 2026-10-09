import type { PageConfig } from '@flarewatch/shared';

export const pageConfig: PageConfig = {
  title: 'FlareWatch demo',
  links: [
    { label: 'Deploy your own', link: 'https://flarewatch.app/docs/deploy' },
    { label: 'GitHub', link: 'https://github.com/saminnet/flarewatch' },
    { label: 'Cloudflare', link: 'https://www.cloudflare.com/' },
  ],
  group: {
    Websites: ['demo_example', 'demo_cloudflare_docs'],
    APIs: ['demo_cloudflare_trace', 'demo_one_dns_trace'],
    'Status Feeds': ['demo_cloudflare_status', 'demo_github_status'],
  },
};
