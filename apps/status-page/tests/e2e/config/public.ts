import type { PageConfig } from '@flarewatch/shared';

// The Partner group holds only the private monitor from worker.ts, so visitors
// never see it. The id is spelled out: importing worker.ts here would put the
// monitor config in the browser bundle, since the page config ships there.
export const pageConfig: PageConfig = {
  title: 'FlareWatch',
  links: [
    { label: 'GitHub', link: 'https://github.com/saminnet/flarewatch' },
    { label: 'Cloudflare', link: 'https://www.cloudflare.com/' },
  ],
  group: {
    Websites: ['demo_example', 'demo_cloudflare_docs'],
    APIs: ['demo_cloudflare_trace', 'demo_one_dns_trace'],
    'Status Feeds': ['demo_cloudflare_status', 'demo_github_status'],
    Partner: ['demo_private_internal'],
  },
};
