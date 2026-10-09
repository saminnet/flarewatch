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

## Check intervals

Set `checkEveryMinutes` on a check monitor to an integer from 1 to 1440. The default is 1. The minute cron spreads checks across slots using a stable hash of each monitor's ID. A skipped monitor records no result and keeps its status and incidents. Heartbeats refuse this setting.

`reminderEveryChecks` still counts minute check runs, including runs that skip the monitor.

Set `downAfterChecks` to an integer from 1 to 10 to require consecutive failed checks before opening an incident. The default is 1. A skipped run does not count. A successful check resets the streak. Until the threshold, the monitor stays up. The incident starts at the first failure in the streak. An open incident keeps the usual flap rules.

## TCP ports

```ts
{ id: 'db', name: 'Database', method: 'TCP_PING', target: 'db.example.com:5432' }
```

The Worker opens a TCP connection to the host and port. A connection is all it checks, so `expectedCodes`, the keyword and JSON settings, `responseHeaderEquals` and `sslCheckEnabled` fail a `TCP_PING` monitor's config.

## DNS records

```ts
{ id: 'dns', name: 'DNS', method: 'DNS', target: 'example.com', dnsRecordType: 'A', dnsExpected: ['192.0.2.1'] }
```

DNS checks query Cloudflare's [DoH JSON endpoint](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/). `dnsRecordType` accepts `A`, `AAAA`, `CNAME`, `MX`, `TXT`, `NS` and `CAA`, and defaults to `A`. Without `dnsExpected`, at least one record of that type must exist. With it, every listed value must match the answer's text exactly. This includes quotes in TXT records and priorities in MX records.

Set `dnsResolver` to another HTTPS endpoint with the same JSON API. A DNS status other than NOERROR fails the check with its name, such as NXDOMAIN. HTTP errors, malformed replies and replies over 1 MiB fail too. DNS monitors refuse proxies, confirmation, HTTP request settings and HTTP assertions.

## Domain expiry

```ts
{ id: 'domain', name: 'Domain registration', method: 'DOMAIN', target: 'example.com', domainExpiryDays: 30 }
```

Use a registrable domain, such as `example.com` or `example.co.uk`. FlareWatch reads the TLD's service from the [IANA RDAP bootstrap file](https://www.iana.org/assignments/rdap-dns) and checks its expiration event. The default interval is 1440 minutes, with the same stable slots as other checks. Override it with `checkEveryMinutes`.

`domainExpiryDays` defaults to 30 and accepts an integer from 1 to 365. Inside the window, the monitor shows as degraded and sends one warning per expiry date, as certificate warnings do. An expired domain fails. A missing RDAP service, failed lookup, missing expiration event or invalid reply also fails, with the cause in the error. Bootstrap and RDAP responses are capped at 1 MiB. FlareWatch uses only HTTPS services and redirects. A TLD with only an HTTP service fails the check.

Each lookup reserves two subrequests. Redirects spend spare requests and stop at the run deadline. DOMAIN monitors use the RDAP service directly and refuse proxies, HTTP request settings and HTTP assertions.

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
- `vpc` runs it through the Worker's `VPC` binding. See [Check a private network through Workers VPC](#check-a-private-network-through-workers-vpc) below.

When the proxy fails, the check fails. Set `checkProxyFallback: true` to fall back to a direct check. This applies to `vpc` too: the fallback then runs from the Worker itself, over the public internet.

### Check a private network through Workers VPC

Set `checkProxy: 'vpc'`, or `confirmVia: 'vpc'`, to check a target the Worker reaches through a [Workers VPC](https://developers.cloudflare.com/workers-vpc/) network: HTTP through the binding's `fetch`, `TCP_PING` through its `connect`. The check runs in the Worker and follows the same rules as a direct one, including redirects, keywords, headers and JSON. Workers VPC is in beta and free on every Workers plan.

You add the binding yourself. The committed `services/worker/wrangler.toml` has none, so a fork without a tunnel deploys it unchanged. Put this block in that file, with your tunnel's UUID:

```toml
[[vpc_networks]]
binding = "VPC"
tunnel_id = "550e8400-e29b-41d4-a716-446655440000"
remote = true
```

The tunnel needs a running `cloudflared` that can reach your target, and routes for its private addresses. `remote = true` lets `wrangler dev` use the real network. Deploy, then point a monitor at a private address:

```ts
{
  id: 'redis',
  name: 'Redis',
  method: 'TCP_PING',
  target: '10.0.1.50:6379',
  checkProxy: 'vpc',
}
```

A monitor set to `vpc` on a Worker without the binding fails every check with an error that says to add it. With `checkProxyFallback: true`, it runs the direct check instead and records that result.

Releases change `wrangler.toml` too. When a release touches the file, GitHub can't sync your fork and offers a pull request instead. Merge from a clone as [Update your fork](deploy.md#update-your-fork) describes, keep your `[[vpc_networks]]` block, and take the release's side everywhere else.

For certificate expiry, set `sslCheckEnabled: true` and `sslCheckDaysBeforeExpiry: 14`. This needs Globalping or a proxy, because the Worker can't see the certificate. `sslCheckDaysBeforeExpiry` must be a whole number from 0 to 3650.

A valid certificate inside this window marks the monitor as degraded, with its expiry date. FlareWatch sends one warning per monitor and expiry date, without retrying a failed delivery. A covering maintenance window pauses the alert. Renewal clears the warning, and the renewed certificate sends its own warning when it enters the window. Warnings open no incident and do not affect uptime. An expired or invalid certificate still fails the check.

FlareWatch sends a threshold of zero to flarewatch-proxy. flarewatch-proxy fails a valid certificate in its last 24 hours because it counts whole days. Globalping uses the exact expiry time.

After upgrading, the next successful check closes an incident caused only by the old certificate threshold. Its closed history stays. Rollback keeps the stored history, but restores the old rule: a near-expiry certificate fails again and can reopen that incident. Remove the new config fields before deploying older code.

Not every place can run every check:

| Setting                | From the Worker             | VPC binding    | Globalping                   | External proxy |
| ---------------------- | --------------------------- | -------------- | ---------------------------- | -------------- |
| `method`               | HTTP, TCP_PING, DNS, DOMAIN | HTTP, TCP_PING | GET, HEAD, OPTIONS, TCP_PING | HTTP, TCP_PING |
| `body`                 | yes                         | yes            | no                           | yes            |
| `sslCheckEnabled`      | no                          | no             | yes                          | yes            |
| `pingProtocol: 'icmp'` | no                          | no             | yes                          | no             |
| `responseHeaderEquals` | yes                         | yes            | no                           | 2.0.0 or later |
| `responseJsonPath`     | yes                         | yes            | yes                          | 2.0.0 or later |

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

The free plan allows a check run 50 subrequests. An HTTP, TCP or DNS check reserves one, a DOMAIN check two, and a Globalping check two plus one per extra poll. The hub and each alert webhook need their own. When the checks due in a minute need more than that, the ones that don't fit skip that minute, as a monitor outside its slot does: no result, and its status and incidents stay as they are. The run logs which ones it skipped. Its starting point moves each minute, so the same checks don't miss every time. CI fails a config whose checks due every minute need more on their own, counting the webhooks in the config but not the ones in `FLAREWATCH_WEBHOOKS`. A confirmation, a `checkProxyFallback` check or an extra Globalping poll runs only while the run has some to spare. FlareWatch holds back one request per webhook for alerts. When the run can't send every alert on its own, each webhook gets the ones that don't fit as one summary, in the same run. A summary uses one request per webhook.

A site in the same Cloudflare zone as the monitor Worker also needs a proxy. Cloudflare sends a Worker's requests for its own zone straight to the origin, so a direct check gets a 503 even when the site is up.
