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

| Secret                        | What it's for                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`       | Required. Your account ID.                                                                    |
| `CLOUDFLARE_API_TOKEN`        | Required. The token from step 2.                                                              |
| `FLAREWATCH_ADMIN_BASIC_AUTH` | Signing in to your status page with a password.                                               |
| `FLAREWATCH_AUTH_SECRET`      | [Signing in with a provider](status-page.md#sign-in-with-a-provider). Any long random string. |
| `FLAREWATCH_OIDC_SECRETS`     | Your providers' client secrets, as JSON: `{"github": "..."}`.                                 |
| `HEARTBEAT_SECRET`            | [Heartbeat](monitors.md#heartbeats) ping URLs. Any long random string.                        |
| `FLAREWATCH_PROXY_TOKEN`      | A [check proxy](monitors.md#other-regions-and-private-networks).                              |
| `FLAREWATCH_WEBHOOKS`         | [Alert webhooks](alerts.md) you keep out of git, as JSON.                                     |

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

## 5. Push to main

The workflow runs the checks and tests. Follow it in the **Actions** tab, or with `gh run watch --repo <you>/flarewatch`. It then creates or reuses a KV namespace called `flarewatch-state` for sign-in sessions and deploys the monitor Worker, then the status page. The run summary shows the page URL, usually `https://flarewatch.<your-subdomain>.workers.dev`.

Secrets are uploaded right after each deploy, so sign-in can take a few seconds to work on the very first one.

## Custom domain

Uncomment the route in `apps/status-page/wrangler.jsonc` and set your domain. The API token then also needs **Zone > Workers Routes > Edit** for that zone. You can also attach the domain in the dashboard instead.

## Cost

A personal or small-team page costs nothing. These are the free tier limits that matter:

| Limit                               | What uses it                                                |
| ----------------------------------- | ----------------------------------------------------------- |
| 100,000 Worker requests/day         | Page views, API calls and heartbeat pings.                  |
| 100,000 Durable Object requests/day | Check runs (1,440 a day), page views, API calls and pings.  |
| 5 million rows read/day             | Check runs (about 18,000 a day) and page views.             |
| 100,000 rows written/day            | Check runs (about 4,300 a day), incidents, pings and edits. |
| 1,000 KV writes/day                 | Sign-ins.                                                   |
| 5 cron triggers per account         | FlareWatch uses one.                                        |

Every check run is saved in the hub, the monitor Worker's Durable Object, so the charts get a sample every minute. For visitors, the status page reuses what it read from the hub for 20 seconds, so a busy page doesn't cost a hub request per view. Page traffic is the limit you're most likely to reach.

See Cloudflare's [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

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

Git lists each file in conflict. In `worker.ts`, `public.ts` and `access.ts`, keep your monitors and settings, and make any config change the changelog asks for. In `apps/status-page/wrangler.jsonc`, take the release's version and put your [custom domain](#custom-domain) back if you set one. Take the release's side everywhere else. Commit the merge, then push to `main`.

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
