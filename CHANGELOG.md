# Changelog

All notable changes to FlareWatch will be documented in this file.

## Unreleased

### Added

- `responseHeaderEquals` and `responseJsonPath` work through flarewatch-proxy 2.0.0 or later, as `checkProxy` or `confirmVia`. An older proxy fails these checks with a message that asks you to update it, because it would skip them and pass. See the table in [Monitors](docs/monitors.md#other-regions-and-private-networks).

### Fixed

- A config with `expectedCodes: []`, an empty `responseKeyword` or `responseForbiddenKeyword`, or `responseHeaderEquals: {}` now fails the config check, so the unit tests fail and the deploy stops. Before, an empty `expectedCodes` failed every check with "Expected status , got 200", and the other three checked nothing.
- A target URL with a username and password, such as `https://user:secret@example.com`, now fails the config check. A Worker dropped them and sent the request without them, so the check never signed in. Send them in `headers` instead.
- A header value that isn't a string or a number now gets the error `headers must map names to strings or numbers`. Before, the error was a bare `Invalid input`.
- A direct check now follows redirects itself, with the same rules as flarewatch-proxy. When a target redirects to another site, the `Cookie`, `Authorization` and `Proxy-Authorization` headers from the monitor no longer travel with it. Before, the runtime kept `Cookie` and `Proxy-Authorization`. A redirect to a URL with a username and password, or past 20 hops, fails the check.

## 3.3.0 - 2026-10-03

Deploys no longer check for 1.x data in KV. If you are still on 1.x, follow the 3.0.0 entry below first.

You can roll back to 3.2.0 on the same storage. A repeating maintenance window then shows as a one-off on its first date, and reminders count from the rollback. Nothing is lost, and updating again restores both.

Your config's monitors are now checked field by field. A misspelt or unknown field, or a field of the wrong type, fails the unit tests and stops the deploy. Before, FlareWatch ignored it.

### Added

- Set `maxLatencyMs` on a website or API monitor to show it as degraded while its last check is slower than that. It sends no alert, opens no incident and doesn't change uptime. A maintenance window that covers the monitor keeps it up.
- `/api/data` gives each monitor a `status`: `up`, `degraded`, `down`, `pending` or `running`.
- **Check now** on a check monitor's page, for the operator. It runs that monitor's check once and shows the result there, without saving it. Scripts can do the same through `POST /api/admin/check`.
- `confirmVia` checks a failing monitor once more from a second place, such as your own flarewatch-proxy or a Globalping probe, and records that result. A blip on one network path no longer opens an incident. See [Confirm from a second place](docs/monitors.md#confirm-from-a-second-place).
- `responseHeaderEquals` checks response headers, and `responseJsonPath` with `responseJsonValue` checks one value in a JSON response. See [Monitors](docs/monitors.md#websites-and-apis).
- Maintenance windows can repeat every day, week or month, on chosen weekdays or a day of the month, until a date or for good. Each run keeps its clock time in the time zone you pick, across daylight saving changes. The dashboard shows the current or next run, and History lists every run. Down alerts, error changes and reminders pause during each run. An outage that alerted before the run still sends its recovery. See [Repeating windows](docs/status-page.md#repeating-windows).
- Send a monitor's alerts to some channels only: give a webhook `monitors`, a list of monitor IDs. Leave it out and the webhook gets every monitor's alerts, as before. See [Routing](docs/alerts.md#routing).
- Reminders while a monitor stays down: set `reminderEveryChecks` on a monitor, at least 30. See [Reminders](docs/monitors.md#reminders).
- The status page sends a Content-Security-Policy. Scripts run only from the page's own origin or with a nonce that changes on every request. See [API, badges and embeds](docs/status-page.md#api-badges-and-embeds).

### Changed

- A late job's badge says `DEGRADED` in yellow instead of `UP`. The badge's `degraded` and `colorDegraded` parameters change that.
- Embeds show late, pending and running jobs the way the dashboard does.
- A job that starts again while its outage is still open shows as down until it succeeds, on its row, in the banner and in the API.
- A monitor that asks its check location for something it can't do fails with an error that names the setting, and the unit tests fail on it before deploy. Before, `sslCheckEnabled` on a check from the Worker, or on a proxy check with `checkProxyFallback`, passed without looking at the certificate, and `pingProtocol: 'icmp'` outside Globalping quietly ran a TCP check. See the table in [Monitors](docs/monitors.md#other-regions-and-private-networks).
- Every check ends within 55 seconds of the check run's start. A longer `timeout` is cut to what is left.
- A fallback or confirmation check, or an extra Globalping poll, runs only while the run has subrequests to spare under the free plan's 50, after the hub's calls and one request per alert webhook. No check sends a request after the run's 55 seconds.
- A `TCP_PING` monitor with `expectedCodes`, `responseKeyword`, `responseForbiddenKeyword`, `responseJsonPath`, `responseHeaderEquals` or `sslCheckEnabled` now fails. Before, it passed on the connection alone.
- `checkProxy: 'worker://...'` is gone. Remove it from your config.
- The admin API rejects a maintenance window with a title, color or monitor list of the wrong type. Before, it dropped the field, and a `monitors` value that wasn't a list covered every monitor. A rejected window's error now says what's wrong. `null` leaves a field out when you create a window, as it already cleared one when you update it.
- The config check rejects a webhook with a field FlareWatch doesn't know, so a misspelt `monitors` can't route every alert to that channel. In `FLAREWATCH_WEBHOOKS` the Worker logs the field, ignores it and still alerts the webhook.
- An error change that no webhook accepts no longer counts toward the 5 an outage may send.
- A Globalping measurement over 1 MiB fails the check, the same limit a direct check puts on a response body. Before, the limit was 4 MiB.
- A maintenance window's description can be at most 2000 characters, its title 200, its color 64, and it can list at most 100 monitors with IDs of at most 100 characters. The hub keeps at most 100 windows and refuses a new one past that. You can still edit the ones it has, and a window saved before these limits still shows and pauses alerts.
- The config check rejects a `statusPage` field FlareWatch doesn't know, so a misspelt one fails the deploy instead of being ignored. `theme`, `customCss`, `themeVars` and `poweredByUrl` are gone from `statusPage`. The first two did nothing. For `themeVars`, set the colours in `apps/status-page/src/styles.css` instead; the `:root` and `.dark` blocks at the top hold every variable. The footer link always points to the FlareWatch repository.
- `logo` and `favicon` take a `data:image/` URL only for PNG, JPEG, GIF, WebP or ICO. An SVG data URL now fails the config check; use a path or an `https:` URL to the SVG file instead.
- `logo` and `favicon` take a path, an `https:` URL or a `data:image/` URL. An `http:` URL now fails the config check, because the page's Content-Security-Policy blocks images from it.
- A heartbeat monitor with a field FlareWatch doesn't know, such as a misspelt `graceSecond`, now fails the config check, as a check monitor does. Before, FlareWatch ignored it.
- Heartbeat pings answer 503 when the Worker has no `HEARTBEAT_RATE_LIMIT` binding. Before, they were taken without a limit. The committed `wrangler.toml` has the binding, so keep it if you edit that file.
- A monitor's page lists maintenance windows up to a year ahead. A window that starts later shows there once it is less than a year away.

### Fixed

- A proxy that reports a latency that is not a finite, non-negative number is treated as an invalid response. Before, one such value made the hub drop every monitor's samples for that hour.
- A failed result a proxy reports no longer carries the proxy token into the public error text.
- A `notification.timeZone` the runtime does not know fails the config check. Before, it passed, and then every alert failed at send time.
- A connection failure the runtime reports as "internal error" with a log reference shows as "Connection failed". The full text stays in the worker's log.
- A mass outage no longer loses down alerts to the free plan's request cap. Alerts a run cannot send wait for the following runs, and waiting does not count as a try. Before, an alert past the cap counted as failed, and after 10 runs it was dropped.
- `vp run dev-status-page` serves the page again. Before, the browser got a 500 for a module that imports `cloudflare:workers` on the server only.
- The `text` template called a recovery "still up" when it came in the same second as the outage began.
- An alert's target URL no longer carries the user name and password from a monitor's `target`.
- Browsers and proxies no longer cache the page that finishes a provider sign-in and sets the session cookie.
- The maintenance dialog shows why a window was refused, such as "Too many maintenance windows", instead of the raw JSON reply.
- A down alert no longer goes out twice when a stalled check run reports a failed delivery after a later run took the alert over.

## 3.2.0 - 2026-10-02

The hub moves your history to its new storage once, when it first starts after the update. You can't roll back to 3.1.0 afterwards.

### Changed

- A monitor that keeps going down and coming back up stays in one outage until it has been up for 15 minutes. The page shows it as down until then, and its recovery alert goes out then. The outage counts as ending when the monitor came back up. Before, each flip wrote several rows, and about 20 flapping monitors could use up the free plan's daily writes.
- Error messages are stored up to their first 500 characters.
- Each monitor keeps at most about 1 MB of incident history. Only a monitor whose long error keeps changing reaches that before 1,000 incidents.
- Both Workers run on the 2026-09-30 compatibility date, up from 2025-11-17. Wrangler is 4.145.

### Fixed

- A page view reads one row per monitor from the hub, plus a few, however long your history is. In 3.1.0 most page views still read every stored incident, because the hub forgets what it kept in memory a few seconds after each request.
- A response-time chart reads 13 rows instead of 721.
- A new incident reads a few dozen rows instead of up to 2,000 for a monitor with a long history.
- A monitor you change from a heartbeat to a regular check no longer stays down because of the job's last state.

## 3.1.0 - 2026-10-01

### Changed

- Each check run reads about a dozen rows from the hub instead of every stored incident, so a long history no longer eats into the free plan's 5 million rows read a day. Page views and response-time charts read only what changed since the last check run.
- History drops a maintenance window 90 days after it ends, the same as incidents.
- A monitor you remove from the config gets its open outage closed. Its history goes after 90 days, like any other.

### Fixed

- A check run that finished after a newer one no longer overwrites the newer results.
- Response-time charts show only the last 12 hours, even when check runs have stopped.

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
- `timeout` on a monitor or a webhook must be a whole number of milliseconds from 1 to 60000. A longer one ran into the next check run. The config check names any monitor that breaks this. A webhook in the `FLAREWATCH_WEBHOOKS` secret with such a timeout still alerts, with the default timeout, and the Worker logs why.
- Links in the config must be http(s) URLs or paths: a monitor's `link`, `links`, `poweredByUrl`, `logo` and `favicon`. `logo` and `favicon` can also be `data:image/` URLs.
- The admin API rejects a maintenance whose `monitors` list holds anything but monitor ids. An empty list still covers every monitor.

### Changed

- A monitor that fails again within 15 minutes of recovering reopens the same incident instead of starting a new one. You still get a new down alert after the full grace period, and History shows one outage.
- Each monitor keeps its newest 1,000 closed incidents.
- An outage sends at most 5 error-change alerts.

### Security

- Only `/embed` pages can be shown in a frame on another site.
- Admin API answers to scripts that sign in with the Basic header are no longer cacheable.
- The sign-in and maintenance endpoints stop reading a request body at 4 KiB and 64 KiB.
- Error answers from check proxies and webhooks, and Cloudflare's trace answer, are read up to 4 KiB. The trace request has a timeout now.
- A TCP check that times out closes its socket.
- Webhook header values are masked in the logs.
- Teams alerts no longer turn a monitor's error text into links.

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
