# Changelog

All notable changes to FlareWatch will be documented in this file.

## 1.0.0 - 2026-07-13

First tagged release.

- Wrangler-owned Cloudflare deploys replace the older Pulumi-owned production deployment model.
- ntfy notification channel, alongside Slack, Discord, Telegram, and custom webhooks.
- Self-deploy setup now requires only two GitHub Actions secrets: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
- The deploy workflow creates or adopts the shared `flarewatch-state` KV namespace, injects it into both Worker configs, and deploys with Wrangler.
