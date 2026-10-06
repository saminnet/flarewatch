# Monitors

Monitors live in `packages/config/src/worker.ts`. [`worker.example.ts`](../packages/config/src/worker.example.ts) has a commented example of each kind.

## Websites and APIs

```ts
{
  id: 'api',
  name: 'API',
  method: 'GET',
  target: 'https://example.com/health',
  expectedCodes: [200],
  responseKeyword: 'ok',
  timeout: 10000,
  maxLatencyMs: 2000,
}
```

A check fails on another status code, when `responseKeyword` is missing from the first 1 MiB of the response, when `responseForbiddenKeyword` is in it, or after `timeout` milliseconds, at most 60000. `expectedCodes` must list at least one code, and each must be a whole number from 100 to 599. Neither keyword can be empty. `headers` and `body` go with the request.

`maxLatencyMs` marks a slow site. Set it to a whole number of milliseconds, at least 1. When the last check took longer than that, the page shows the monitor as degraded until a check comes in at or under it. It sends no alert, opens no incident and doesn't change uptime. A slow check taken while a maintenance window covered the monitor shows as up, even after the window ends.

To check more than a keyword:

```ts
{
  id: 'api',
  name: 'API',
  method: 'GET',
  target: 'https://example.com/health',
  responseHeaderEquals: { 'Content-Type': 'application/json' },
  responseJsonPath: '$.checks[0].status',
  responseJsonValue: 'pass',
}
```

- `responseHeaderEquals` lists headers the response must have, with exactly these values. List at least one. Header names ignore case; values don't. Names must be valid HTTP header names, so no spaces or colons, and values must be strings.
- `responseJsonPath` points into a JSON response, and the value there must equal `responseJsonValue`: the same string, number, `true`, `false` or `null`. `"3"` doesn't equal `3`. Paths use dots for keys and brackets for list items: `$.a.b[0].c`. `$` is the whole response. Set both fields or neither.

The check fails when the response isn't JSON, is 1 MiB or larger, or has nothing at the path. The error names the header or path, never what the response held, because errors show on the status page.

A field FlareWatch doesn't know, such as a misspelt `expectedCode`, fails the config. The same goes for heartbeats.

The monitor name links to its target on the status page, without the query string. A target can't hold a username and password. Send them in `headers`. Set `link: false` to hide the URL, or `link: 'https://...'` to link somewhere else.

## TCP ports

```ts
{ id: 'db', name: 'Database', method: 'TCP_PING', target: 'db.example.com:5432' }
```

The Worker opens a TCP connection to the host and port. A connection is all it checks, so `expectedCodes`, the keyword and JSON settings, `responseHeaderEquals` and `sslCheckEnabled` fail a `TCP_PING` monitor's config.

## Private monitors

`private: true` keeps a monitor off the public page and the public API. It is still checked, saved and alerted. When you sign in, you see it with a Private badge.

## Dependencies

`dependsOn: ['proxy']` tells FlareWatch the monitor reaches its target through another one. While that one is down, this one doesn't alert. See [Alerts](alerts.md#dependencies).

To stop one network path from raising an outage, use [`confirmVia`](#confirm-from-a-second-place) instead.

## Reminders

`reminderEveryChecks: 60` sends a reminder every 60 check runs while the monitor stays down after its down alert. Checks run every minute, so that's about once an hour. The lowest you can set is 30. Leave it out and the monitor sends no reminders.

```ts
{ id: 'api', name: 'API', method: 'GET', target: 'https://example.com/health', reminderEveryChecks: 60 }
```

Each reminder says how long the monitor has been down and which reminder it is: reminder 1, reminder 2 and so on. It goes to the same channels as the down alert. No reminder goes out during a maintenance window that covers the monitor, while a monitor in its `dependsOn` is down, or while a flapping monitor is back up and waiting out its 15 minutes. A reminder that no channel accepts isn't sent again, and the next one keeps its number. When the outage reopens, the count starts over from its new down alert. Heartbeats take `reminderEveryChecks` too.

## Groups

Group monitors on the page in `packages/config/src/public.ts`:

```ts
group: { Websites: ['site', 'docs'], APIs: ['api'] },
```

## Heartbeats

A heartbeat watches a job that reports in, like a backup, a cron script or a CI pipeline. It goes down when the ping doesn't arrive in time, or when the job reports a failure.

```ts
{
  id: 'nightly-backup',
  name: 'Nightly backup',
  method: 'HEARTBEAT',
  periodSeconds: 86400, // how often the job runs
  graceSeconds: 3600, // how late it may be
}
```

Each heartbeat has a ping URL, `https://<your-status-page>/ping/<id>/<token>`. Signed in as the operator, you can copy it from the monitor's page. The token comes from the `HEARTBEAT_SECRET` secret. To compute it yourself:

```bash
printf 'v1:%s' "nightly-backup" \
  | openssl dgst -sha256 -hmac "$HEARTBEAT_SECRET" -binary \
  | openssl base64 -A | tr '+/' '-_' | tr -d '=' | cut -c1-32
```

| Route                                  | Means                                     |
| -------------------------------------- | ----------------------------------------- |
| `GET\|POST\|HEAD /ping/<id>/<token>`   | The job finished.                         |
| `GET\|POST /ping/<id>/<token>/start`   | The job started.                          |
| `POST /ping/<id>/<token>/fail`         | The job failed. The body is the message.  |
| `GET\|POST /ping/<id>/<token>/<0-255>` | The job exited with this code. 0 is fine. |

Ping only on success:

```bash
./backup.sh && curl -fsS "https://status.example.com/ping/nightly-backup/<token>"
```

Or send the exit code, so a failure shows at the next check instead of after the grace period:

```bash
./backup.sh; curl -fsS "https://status.example.com/ping/nightly-backup/<token>/$?"
```

With systemd:

```ini
[Service]
Type=oneshot
ExecStartPre=/usr/bin/curl -fsS https://status.example.com/ping/nightly-backup/<token>/start
ExecStart=/usr/local/bin/backup.sh
ExecStopPost=/usr/bin/curl -fsS "https://status.example.com/ping/nightly-backup/<token>/${EXIT_STATUS}"
```

Pings are limited to 30 a minute per monitor, which stops a looping script. Jobs that run every minute are fine.

## Other regions and private networks

By default the Worker runs each check itself. `checkProxy` runs it somewhere else:

- `globalping://<token>?magic=fra&ipVersion=4` runs it from [Globalping](https://www.jsdelivr.com/globalping) probes in that location. `TCP_PING` monitors can then set `pingProtocol: 'icmp'`. Keep the token out of git.
- `https://your-proxy.example.com/check` sends it to [flarewatch-proxy](https://github.com/saminnet/flarewatch-proxy), which you run where it can reach your private network. Set the `FLAREWATCH_PROXY_TOKEN` secret to the proxy's token.

When the proxy fails, the check fails. Set `checkProxyFallback: true` to fall back to a direct check.

For certificate expiry, set `sslCheckEnabled: true` and `sslCheckDaysBeforeExpiry: 14`. This needs Globalping or a proxy, because the Worker can't see the certificate. `sslCheckDaysBeforeExpiry` must be a whole number from 0 to 3650.

Not every place can run every check:

| Setting                | From the Worker | Globalping                   | External proxy |
| ---------------------- | --------------- | ---------------------------- | -------------- |
| `method`               | any             | GET, HEAD, OPTIONS, TCP_PING | any            |
| `body`                 | yes             | no                           | yes            |
| `sslCheckEnabled`      | no              | yes                          | yes            |
| `pingProtocol: 'icmp'` | no              | yes                          | no             |
| `responseHeaderEquals` | yes             | no                           | 2.0.0 or later |
| `responseJsonPath`     | yes             | yes                          | 2.0.0 or later |

A monitor that asks a place for something it can't do fails on every check, with an error that names the setting, such as `sslCheckEnabled is not supported by a direct check`. This counts the fallback too: `sslCheckEnabled` with `checkProxyFallback: true` fails, because the fallback runs from the Worker. The unit tests run the same rules on your config, so the deploy stops before such a monitor goes live.

`responseHeaderEquals` and `responseJsonPath` need flarewatch-proxy 2.0.0 or later. The unit tests can't see which version you run. An older proxy fails these checks with `Proxy is too old for header and JSON checks: update to flarewatch-proxy 2.0.0`. With `checkProxyFallback: true`, the Worker then runs the check itself.

### Confirm from a second place

`confirmVia` names a second place to check from, in the same formats as `checkProxy`. When a check fails, FlareWatch runs it once more from there, straight away, and records that result and its location. The monitor goes down only when the second place sees it down too. A check that passes costs nothing extra. With `checkProxyFallback`, FlareWatch tries the Worker first. Confirmation runs only if that check fails too and the run has time and subrequests left.

```ts
{
  id: 'site',
  name: 'Website',
  method: 'GET',
  target: 'https://example.com',
  confirmVia: 'https://your-proxy.example.com/check',
}
```

This is how to use your own [flarewatch-proxy](https://github.com/saminnet/flarewatch-proxy) as a second vantage point: a blip between Cloudflare and your site no longer opens an incident unless the proxy sees it too. `confirmVia: 'globalping://<token>?magic=fra'` does the same from a Globalping probe. `confirmVia` must name a different place than `checkProxy`, and the table above applies to it too. A confirmation that fails for any reason counts as down, so a proxy older than 2.0.0 can't clear a failed header or JSON check.

The free plan allows a check run 50 subrequests. Each check is one, a Globalping check two plus one per extra poll, and the hub and each alert webhook need their own. A confirmation, a `checkProxyFallback` check or an extra Globalping poll runs only while the run has some to spare, so with many monitors failing at once, the later ones keep their first result. FlareWatch holds back one request per webhook, which covers the first alert of a run; with many monitors going down in the same minute, later alerts can still go over the limit.

A site in the same Cloudflare zone as the monitor Worker also needs a proxy. Cloudflare sends a Worker's requests for its own zone straight to the origin, so a direct check gets a 503 even when the site is up.
