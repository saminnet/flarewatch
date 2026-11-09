# Deploy

FlareWatch deploys from GitHub Actions into your own Cloudflare account. The first deploy takes about ten minutes.

## 1. Fork the repo

Fork [saminnet/flarewatch](https://github.com/saminnet/flarewatch). Your fork deploys from your GitHub account, with your secrets.

GitHub turns workflows off in a new fork. Open the fork's **Actions** tab and click **I understand my workflows, go ahead and enable them**. Nothing deploys until you do.

With the GitHub CLI:

```bash
gh repo fork saminnet/flarewatch --clone --default-branch-only
```

Then turn on workflows in the **Actions** tab.

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

In your fork, open **Settings > Secrets and variables > Actions**. Only the first two are required. The rest turn on optional features.

| Secret                        | What it's for                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`       | Required. Your account ID.                                                                                                                  |
| `CLOUDFLARE_API_TOKEN`        | Required. The token from step 2.                                                                                                            |
| `FLAREWATCH_ADMIN_BASIC_AUTH` | Signing in to your status page with a password.                                                                                             |
| `FLAREWATCH_AUTH_SECRET`      | [Signing in with a provider](status-page.md#sign-in-with-a-provider). At least 32 characters: `openssl rand -base64 32`.                    |
| `FLAREWATCH_OIDC_SECRETS`     | Your providers' client secrets, as JSON: `{"github": "..."}`.                                                                               |
| `RESEND_API_KEY`              | [Email subscribers](status-page.md#email-subscribers). A Resend key for the default provider. Cloudflare Email Service needs no Resend key. |
| `SUBSCRIBER_SECRET`           | Subscriber confirmation and unsubscribe links. At least 32 random characters: `openssl rand -base64 32`.                                    |
| `TURNSTILE_SECRET`            | Optional verification for the subscriber form. Set `TURNSTILE_SITE_KEY` in the status page's Wrangler vars too.                             |
| `HEARTBEAT_SECRET`            | [Heartbeat](monitors.md#heartbeats) ping URLs. At least 32 characters: `openssl rand -base64 32`.                                           |
| `FLAREWATCH_PROXY_TOKEN`      | A [check proxy](monitors.md#other-regions-and-private-networks).                                                                            |
| `FLAREWATCH_WEBHOOKS`         | [Alert webhooks](alerts.md) you keep out of git, as JSON.                                                                                   |

With the GitHub CLI, each command prompts for the value:

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID --repo <you>/flarewatch
gh secret set CLOUDFLARE_API_TOKEN --repo <you>/flarewatch
```

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

### Cloudflare subscriber mail

For the second subscriber provider, set `statusPage.subscribers.provider: 'cloudflare'` in `packages/config/src/public.ts`. Add this optional block to `services/worker/wrangler.toml`:

```toml
[[send_email]]
name = "SUBSCRIBER_EMAIL"
```

In JSON, use `"send_email": [{ "name": "SUBSCRIBER_EMAIL" }]`. Leave the block out for the default Free-plan deployment. Set `PUBLIC_ORIGIN` and the `SUBSCRIBER_SECRET` secret. Onboard the sending domain to Email Service and use a verified sender address.

Arbitrary recipients require Workers Paid: 3,000 emails per month are included, then $0.35 per 1,000. Free has no outbound mail to arbitrary recipients. See [Cloudflare pricing](https://developers.cloudflare.com/email-service/platform/pricing/).

The binding accepts plain message objects, without the legacy `cloudflare:email` class. Limits are 50 addresses across to/cc/bcc, 5 MiB per message, 16 KB of custom headers total and 2,048 bytes per header value. FlareWatch sends one message per recipient and records progress after each success. Cloudflare has no batch endpoint or idempotency key. A crash between send and progress write can double-send one message. Retries resume at the saved index without Resend's 23-hour ambiguity cutoff. The daily cap and backoff apply to both providers.

Cloudflare throws `Error` objects with codes. `E_RATE_LIMIT_EXCEEDED` retries with backoff. `E_SENDER_NOT_VERIFIED` and `E_SENDER_DOMAIN_NOT_AVAILABLE` log permanent failures and drop the affected event, so fix the domain before enabling signup. See [subscriber setup](status-page.md#cloudflare-email-service) and the [Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).

## 5. Push to main

The workflow runs the checks and tests. Follow it in the **Actions** tab, or with `gh run watch --repo <you>/flarewatch`. It then creates or reuses a KV namespace called `flarewatch-state` for sign-in sessions and deploys the monitor Worker, then the status page. The run summary shows the page URL, usually `https://flarewatch.<your-subdomain>.workers.dev`.

Secrets are uploaded right after each deploy, so sign-in can take a few seconds to work on the very first one.

## Custom domain

Uncomment the route in `apps/status-page/wrangler.jsonc` and set your domain. The API token then also needs **Zone > Workers Routes > Edit** for that zone. You can also attach the domain in the dashboard instead.

## Cost

A personal or small-team page costs nothing. These are the free tier limits that matter:

| Limit                               | What uses it                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 100,000 Worker requests/day         | Page views, API calls and heartbeat pings.                                                                     |
| 100,000 Durable Object requests/day | Check runs (1,440 a day), page views, API calls and pings.                                                     |
| 5 million rows read/day             | Check runs (about 9,000 a day, plus 1,440 per monitor) and page views (two rows per monitor each, plus a few). |
| 100,000 rows written/day            | Check runs (about 2,900 a day), incidents, pings and edits.                                                    |
| 1,000 KV writes/day                 | Sign-ins.                                                                                                      |
| 5 cron triggers per account         | FlareWatch uses one.                                                                                           |

Every check run is saved in the hub, the monitor Worker's Durable Object, so the charts get a sample every minute. For visitors, the status page keeps what it read from the hub for 20 seconds, and a monitor's response times for 30 seconds, so a busy page doesn't cost a hub request per view. It keeps them in memory and in Cloudflare's cache in each location. Signed-in views read monitor status from the hub every time. On a `workers.dev` address Cloudflare's cache does nothing, so only the memory copy helps. Page traffic is the limit you're most likely to reach.

An open, visible status page refreshes about once a minute, so one tab left open all day makes at least 1,400 Worker requests. A background tab makes none.

A monitor that keeps going down and coming back up adds about 1,500 rows written a day, more if its error changes each time.

See Cloudflare's [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Hub location

Cloudflare creates the hub near whatever first talks to it, and it stays there. If that was a check run in Singapore, every page view from Europe waits on a round trip to Singapore.

To pick the region, set `hubLocation` in `packages/config/src/worker.ts` before your first deploy, for example `hubLocation: 'weur'` for western Europe. Choose the region closest to most of your visitors. Cloudflare treats it as a hint, not a promise. It has no effect on a hub that already exists. Leave it out to let Cloudflare choose.

The values are `wnam`, `enam`, `sam`, `weur`, `eeur`, `apac`, `apac-ne`, `apac-se`, `oc`, `afr` and `me`.

## Update your fork

New releases land in [saminnet/flarewatch](https://github.com/saminnet/flarewatch). Read the [changelog](../CHANGELOG.md) for breaking changes before you update.

Most updates happen on GitHub. Open your fork, select **Sync fork**, then **Update branch**. With the GitHub CLI, `gh repo sync <you>/flarewatch` does the same.

Your config lives in `packages/config`, and releases change those files too. When a release changes the same part of a file as you did, GitHub can't sync and offers a pull request instead. Merge from a clone of your fork:

```bash
git remote add upstream https://github.com/saminnet/flarewatch.git
git fetch upstream
git switch main
git merge upstream/main
```

Git lists each file in conflict. In `worker.ts`, `public.ts` and `access.ts`, keep your monitors and settings, and make any config change the changelog asks for. In `services/worker/wrangler.toml`, keep your `[[vpc_networks]]` block if you added one. In `apps/status-page/wrangler.jsonc`, take the release's version and put your [custom domain](#custom-domain) back if you set one. Take the release's side everywhere else. Commit the merge, then push to `main`.

Don't pick the option in the **Sync fork** menu that discards your commits, and don't run `gh repo sync --force`. Both throw away your config. Your secrets are safe either way: they live in the repo settings, not in git.

A push to `main` starts the deploy, as in step 5. If a sync on GitHub didn't start it, run **CI and Deploy** from the **Actions** tab, or `gh workflow run "CI and Deploy" --repo <you>/flarewatch`.

## Upgrading from 1.x

3.0 can't read 1.x data. Update to 2.3.1 first and follow [its upgrade steps](https://github.com/saminnet/flarewatch/blob/v2.3.1/docs/deploy.md#upgrading-from-1x), which copy your history across. Then update to the latest release. The 3.0.0 entry in the [changelog](../CHANGELOG.md) has the git commands. If you skip that step, the deploy stops and says so.

## Uninstall

```bash
vp exec --filter worker -- wrangler delete flarewatch-worker
vp exec --filter status-page -- wrangler delete flarewatch
vp exec --filter worker -- wrangler kv namespace delete --namespace-id "<flarewatch-state-id>"
```

`wrangler kv namespace list` shows its ID. Uptime history lives in the monitor Worker's Durable Object. Afterwards, check the Durable Objects page in the Cloudflare dashboard and delete the namespace there if it's still listed.
