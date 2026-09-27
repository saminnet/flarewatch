# Deploy

FlareWatch deploys from GitHub Actions into your own Cloudflare account. The first deploy takes about ten minutes.

## 1. Fork the repo

Fork [saminnet/flarewatch](https://github.com/saminnet/flarewatch) and leave GitHub Actions on.

## 2. Create a Cloudflare API token

In the Cloudflare dashboard, open **My Profile > API Tokens > Create Token > Custom token**. Scope it to the one account you deploy into and give it these permissions:

| Resource | Permission         | Level |
| -------- | ------------------ | ----- |
| Account  | Workers Scripts    | Edit  |
| Account  | Workers KV Storage | Edit  |
| Account  | Account Settings   | Read  |
| User     | User Details       | Read  |
| User     | Memberships        | Read  |

The **Edit Cloudflare Workers** template works too, scoped to your account. It grants a few extra Workers permissions.

Your account ID is under **Workers & Pages > Account details**.

## 3. Add secrets to your fork

In your fork, open **Settings > Secrets and variables > Actions**.

| Secret                        | What it's for                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`       | Required. Your account ID.                                                                    |
| `CLOUDFLARE_API_TOKEN`        | Required. The token from step 2.                                                              |
| `FLAREWATCH_ADMIN_BASIC_AUTH` | Signing in to your status page with a password.                                               |
| `FLAREWATCH_AUTH_SECRET`      | [Signing in with a provider](status-page.md#sign-in-with-a-provider). Any long random string. |
| `FLAREWATCH_OIDC_SECRETS`     | Your providers' client secrets, as JSON: `{"github": "..."}`.                                 |
| `HEARTBEAT_SECRET`            | [Heartbeat](monitors.md#heartbeats) ping URLs. Any long random string.                        |
| `FLAREWATCH_PROXY_TOKEN`      | A [check proxy](monitors.md#other-regions-and-private-networks).                              |

Make the password secret from a username and password, and paste the whole output as the value:

```bash
vp run auth:secret -- <username> '<password>'
```

Each deploy copies the optional secrets onto the Workers. Removing one from GitHub doesn't remove it from the Worker. Delete it there by hand:

```bash
vp exec --filter status-page -- wrangler secret delete FLAREWATCH_ADMIN_BASIC_AUTH
```

## 4. Edit the config

- `packages/config/src/worker.ts`: [monitors](monitors.md) and [alerts](alerts.md).
- `packages/config/src/public.ts`: [page settings](status-page.md#page-settings).

The repo ships demo monitors, so a first deploy shows a working page. Replace them before you rely on the alerts.

## 5. Push to main

The workflow runs the checks and tests. It then creates or reuses a KV namespace called `flarewatch-state` for sign-in sessions and deploys the monitor Worker, then the status page. The run summary shows the page URL, usually `https://flarewatch.<your-subdomain>.workers.dev`.

Secrets are uploaded right after each deploy, so sign-in can take a few seconds to work on the very first one.

## Custom domain

Uncomment the route in `apps/status-page/wrangler.jsonc` and set your domain. The API token then also needs **Zone > Workers Routes > Edit** for that zone. You can also attach the domain in the dashboard instead.

## Cost

A personal or small-team page costs nothing. These are the free tier limits that matter:

| Limit                               | What uses it                                                |
| ----------------------------------- | ----------------------------------------------------------- |
| 100,000 Worker requests/day         | Page views, API calls and heartbeat pings.                  |
| 100,000 Durable Object requests/day | Check runs (1,440 a day), page views, API calls and pings.  |
| 100,000 rows written/day            | Check runs (about 4,300 a day), incidents, pings and edits. |
| 1,000 KV writes/day                 | Sign-ins.                                                   |
| 5 cron triggers per account         | FlareWatch uses one.                                        |

Every check run is saved in the hub, the monitor Worker's Durable Object, so the charts get a sample every minute. The status page reuses what it read from the hub for 20 seconds, so a busy page doesn't cost a hub request per view. Page traffic is the limit you're most likely to reach.

See Cloudflare's [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Uninstall

```bash
vp exec --filter worker -- wrangler delete flarewatch-worker
vp exec --filter status-page -- wrangler delete flarewatch
vp exec --filter worker -- wrangler kv namespace delete --namespace-id "<flarewatch-state-id>"
```

`wrangler kv namespace list` shows its ID. Uptime history lives in the monitor Worker's Durable Object. Afterwards, check the Durable Objects page in the Cloudflare dashboard and delete the namespace there if it's still listed.

## Upgrading from 1.x

Remove `kvWriteCooldownMinutes` from `worker.ts` if you set it, then push. On its first run, the new version copies your uptime history, heartbeat runs and maintenance windows from KV into the hub. It leaves the KV data as it was, so you can still go back to 1.x.
