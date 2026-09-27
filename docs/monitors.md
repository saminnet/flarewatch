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
}
```

A check fails on another status code, when `responseKeyword` is missing from the first 1 MiB of the response, when `responseForbiddenKeyword` is in it, or after `timeout` milliseconds. `headers` and `body` go with the request.

The monitor name links to its target on the status page, without any credentials or query string. Set `link: false` to hide the URL, or `link: 'https://...'` to link somewhere else.

## TCP ports

```ts
{ id: 'db', name: 'Database', method: 'TCP_PING', target: 'db.example.com:5432' }
```

The Worker opens a TCP connection to the host and port.

## Private monitors

`private: true` keeps a monitor off the public page and the public API. It is still checked, saved and alerted. When you sign in, you see it with a Private badge.

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

Each heartbeat has a ping URL, `https://<your-status-page>/ping/<id>/<token>`. When you're signed in, the monitor's page has a button that copies it. The token comes from the `HEARTBEAT_SECRET` secret. To compute it yourself:

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

Or send the exit code, so a failure shows up right away:

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

For certificate expiry, set `sslCheckEnabled: true` and `sslCheckDaysBeforeExpiry: 14`. This needs Globalping or a proxy, because the Worker can't see the certificate.

A site in the same Cloudflare zone as the monitor Worker also needs a proxy. Cloudflare sends a Worker's requests for its own zone straight to the origin, so a direct check gets a 503 even when the site is up.
