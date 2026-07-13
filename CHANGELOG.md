# Changelog

All notable changes to FlareWatch will be documented in this file.

## Unreleased

- Wrangler-owned Cloudflare deploys replace the older Pulumi-owned production deployment model.
- Self-deploy setup now requires only two GitHub Actions secrets: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
- The deploy workflow creates or adopts the shared `flarewatch-state` KV namespace, injects it into both Worker configs, and deploys with Wrangler.
