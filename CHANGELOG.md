# Changelog

All notable changes to FlareWatch will be documented in this file.

## Unreleased

### Breaking changes

- `FLAREWATCH_STATUS_PAGE_BASIC_AUTH` is gone. Set `visibility: 'private'` in the page config instead. Visitors then get the sign-in page, and the dashboard, History, monitor pages, badges, embeds and the JSON API are closed to them. While the old secret is still set on the Worker, the page stays private-only, so upgrading never opens a private page.
- The Events page is now History, at `/history`. Old `/events` links return 404.
- Config lives only in `packages/config`. The `CONFIG_KV` binding, which loaded config from KV, is no longer read, and neither is `STATE_KV` as a second name for `FLAREWATCH_STATE`. CI now checks the config, so an invalid one fails before it deploys.
- The `/admin` page is gone. Sign in at `/login` (`/admin` redirects there). Once signed in, the same pages show private monitors, and you add and edit maintenance windows on History.
- Monitor state lives in a Durable Object instead of KV, and every check run is saved, so latency charts get a sample every minute. The first start after the upgrade copies your 1.x history across and leaves the KV data in place. `kvWriteCooldownMinutes` is gone: remove it from `worker.ts`, or the build fails. A check that crashes now opens an incident instead of only counting as down.

### Added

- Sign in with any OpenID Connect provider or GitHub, set in `packages/config/src/access.ts`. Besides operators, you can let in members, who see private monitors but change nothing, and audiences, who see certain page groups.
- Sign-in attempts are limited per IP by a rate-limit binding, so failed logins no longer use KV writes.

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
