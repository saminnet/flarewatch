# Changelog

All notable changes to FlareWatch will be documented in this file.

## 3.0.0 - 2026-09-30

3.0 removes the code that moved 1.x installs onto 2.x. On 2.x, update as usual. If you're still on 1.x, update to 2.3.1 first, from a clone of your fork with `upstream` set up as in [Update your fork](docs/deploy.md#update-your-fork):

```bash
git fetch upstream --tags
git merge v2.3.1
git push
```

Once that deploy has run, merge `upstream/main` and push again. If you skip that step, the deploy stops and says so.

### Breaking changes

- 3.0 no longer copies 1.x data from KV into the hub, and the monitor Worker has no KV binding anymore. If KV still holds 1.x data that was never copied, the deploy stops.
- `FLAREWATCH_STATUS_PAGE_BASIC_AUTH` is no longer read. Set `visibility: 'private'` in the page config instead. If the status page still has that secret, the deploy stops and says how to remove it, so updating never opens a private page.
- `/admin` and `/events` no longer redirect. Use `/login` and `/history`.

## 2.3.1 - 2026-09-29

### Security

- Fixed an authorization bug in the status page's admin API. Update your fork.

## 2.3.0 - 2026-09-28

### Added

- The optional `FLAREWATCH_WEBHOOKS` secret holds alert webhooks as JSON, so their URLs and tokens stay out of your fork. See [Alerts](docs/alerts.md).

### Fixed

- `/embed/<monitor>` shows only the status card, without the page header and footer, and `theme=light` or `theme=dark` applies to the whole frame.

## 2.2.0 - 2026-09-28

### Added

- `dependsOn` on a monitor lists the monitors it reaches its target through. While one of them is down, it sends no alert of its own, and that monitor's alert names it under "Also down". See [Alerts](docs/alerts.md#dependencies).

### Changed

- FlareWatch keeps track of which outages it alerted about. A down alert that no webhook accepted is tried again on each check run, up to 10 times. A recovery alert only follows a down alert that went out, and a missed check at the end of `gracePeriod` no longer drops the alert.
- A monitor that is still down when its maintenance window ends now alerts. It used to stay silent.
- Outages already open when you upgrade stay silent, recovery included. After upgrading, check the status page for monitors that were down at the time.

## 2.1.0 - 2026-09-28

### Changed

- Each row on the dashboard shows the monitor's last 90 days, or the last 30 on a phone. Jobs show their recent runs. The row still opens the monitor's page.
- Colors are stricter. The uptime badge turns amber below 99.9% and red below 99%, where it used to stay green down to 99%. A day turns red after about 15 minutes down, not 12 hours.

## 2.0.0 - 2026-09-28

### Breaking changes

- Monitor state lives in a Durable Object instead of KV, and every check run is saved, so latency charts get a sample every minute. The first start after the upgrade copies your 1.x history across, leaves the 1.x keys in KV in place, and adds an `imported_to_hub` key to show the copy happened. Remove `kvWriteCooldownMinutes` from `worker.ts`, or the build fails.
- A check that crashes now opens an incident instead of only counting as down.
- `FLAREWATCH_STATUS_PAGE_BASIC_AUTH` is gone. Set `visibility: 'private'` in the page config instead. Visitors then get the sign-in page, and the dashboard, History, monitor pages, badges, embeds and the JSON API are closed to them. While the old secret is still set on the Worker, the page stays private-only, so upgrading never opens a private page.
- The `/admin` page is gone. Sign in at `/login` (`/admin` redirects there). Once signed in, the same pages show private monitors, and you add and edit maintenance windows on History.
- The Events page is now History, at `/history`. Old `/events` links redirect there.
- Config lives only in `packages/config`. The `CONFIG_KV` binding is no longer read, and neither is `STATE_KV` as a second name for `FLAREWATCH_STATE`. CI checks the config, so an invalid one fails before it deploys.
- Everyone signed in with the password signs in once more after the upgrade. A password session now ends when `FLAREWATCH_ADMIN_BASIC_AUTH` changes.
- Password sign-in needs the `LOGIN_RATE_LIMIT` binding from `wrangler.jsonc`, and refuses to run without it.
- A monitor name links to its target without the credentials or query string. Set `link` to a full URL if you need them.
- `responseKeyword` and `responseForbiddenKeyword` look at the first 1 MiB of a response only.

### Added

- Heartbeat monitors for jobs that report in, like backups, cron scripts and CI pipelines. One goes down when a ping is late or the job reports a failure.
- Private monitors, checked and alerted as usual but shown only to people signed in.
- A page per monitor, with its 90-day history, a 12-hour latency chart and its incidents.
- Sign in with any OpenID Connect provider or GitHub, set in `packages/config/src/access.ts`. Besides operators, you can let in members, who see private monitors but change nothing, and audiences, who see certain page groups.
- Sign-in attempts are limited per IP by a rate-limit binding, so failed logins no longer use KV writes.

### Fixed

- Slack, Discord, Zulip and Google Chat alerts no longer let text from a monitored site ping everyone or add links.
- A failing check proxy shows as `Proxy HTTP <status>` on the page. Its response body goes to the Worker log, with the proxy token taken out.
- Webhook errors in the Worker log no longer quote the webhook URL.
- An oversized answer from a monitored site, GlobalPing or a check proxy fails that one check instead of the whole run.

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
