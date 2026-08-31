# Changelog

All notable changes to FlareWatch will be documented in this file.

## 1.1.0 - 2026-08-31

- GlobalPing TCP_PING monitors on port 443 no longer fail with a missing port error.
- The shipped demo groups its monitors.
- Documented that monitoring a site in the same Cloudflare zone needs a check proxy.
- Dependencies updated, including TypeScript 7, Cloudflare workers-types 5, and jsdom 30.
- Wrangler stays at 4.108.0 and `@cloudflare/vite-plugin` is pinned to 1.43.2. Newer versions crash the local dev server on Linux, which breaks the browser tests.
- Renovate config for automated dependency updates.

## 1.0.0 - 2026-07-13

First tagged release.

- Wrangler-owned Cloudflare deploys replace the older Pulumi-owned production deployment model.
- ntfy notification channel, alongside Slack, Discord, Telegram, and custom webhooks.
- Self-deploy setup now requires only two GitHub Actions secrets: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
- The deploy workflow creates or adopts the shared `flarewatch-state` KV namespace, injects it into both Worker configs, and deploys with Wrangler.
