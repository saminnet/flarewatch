import type { PageConfig } from '@flarewatch/shared';

export const pageConfig: PageConfig = {
  title: 'FlareWatch',
  links: [
    { label: 'GitHub', link: 'https://github.com/saminnet/flarewatch' },
    { label: 'Cloudflare', link: 'https://www.cloudflare.com/' },
  ],
  group: {
    Demo: ['demo_example', 'demo_cloudflare_trace', 'demo_cloudflare_status'],
  },
};
