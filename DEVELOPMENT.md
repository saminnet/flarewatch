# Development

Notes for working on FlareWatch locally.

## Commands

```bash
vp install

# Dev
vp run dev
vp run dev-worker

# Quality
vp check
vp fmt . --check
vp fmt . --write

# Builds (used by CI and deploys)
vp run build
vp run status-page-build
vp run worker-build
```

Run `vp config` once after cloning if you want the local Vite+ pre-commit hook.

## Architecture

- `services/worker` runs scheduled checks and writes state to KV (`FLAREWATCH_STATE` binding).
- `apps/status-page` reads the same KV state and renders the UI on Cloudflare Workers.
- `/admin` (optional) manages maintenances stored in the same KV under the `maintenances` key.
- Optional external proxy (`https://github.com/saminnet/flarewatch-proxy`) executes checks from custom locations (private networks, TCP, SSL).

## Deployment Model

Production self-deploys are owned by Wrangler:

| Resource           | Notes                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| KV namespace       | `flarewatch-state`, shared by both Workers                               |
| Monitoring Worker  | `flarewatch-worker`, deployed from `services/worker/wrangler.toml`       |
| Cron trigger       | Attached to monitoring Worker every minute                               |
| Status page Worker | `flarewatch`, deployed from `apps/status-page/dist/server/wrangler.json` |

GitHub Actions creates the KV namespace if needed, injects its namespace ID into both wrangler configs, deploys the monitoring Worker first, then builds and deploys the status page.

## Configuration

- Worker: `packages/config/src/worker.ts` (examples: `packages/config/src/worker.example.ts`)
- Status page: `packages/config/src/public.ts` (examples: `packages/config/src/public.example.ts`)
- Theming (supported tokens, `themeVars`, safety floor): [apps/status-page/THEMING.md](apps/status-page/THEMING.md)

## Secrets

Required GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Optional GitHub Actions secrets are uploaded with `wrangler secret put` when set:

- `FLAREWATCH_PROXY_TOKEN`
- `FLAREWATCH_STATUS_PAGE_BASIC_AUTH`
- `FLAREWATCH_ADMIN_BASIC_AUTH`

Secrets are uploaded right after each `wrangler deploy`, so the very first deployment can serve traffic for a few seconds before basic auth is active. Removing a GitHub secret does not remove the Worker secret — delete it manually, for example:

```bash
vp exec --filter status-page -- wrangler secret delete FLAREWATCH_STATUS_PAGE_BASIC_AUTH
```

## Deployment

- Recommended: GitHub Actions (`.github/workflows/deploy.yml`)
- Manual:
  1. Create or find the shared KV namespace:
     ```bash
     vp exec --filter worker -- wrangler kv namespace create flarewatch-state
     vp exec --filter worker -- wrangler kv namespace list
     ```
  2. Replace `__FLAREWATCH_STATE_KV_NAMESPACE_ID__` in `services/worker/wrangler.toml` and `apps/status-page/wrangler.jsonc` with the namespace ID.
  3. Deploy the monitoring Worker:
     ```bash
     vp exec --filter worker -- wrangler deploy --config wrangler.toml
     ```
  4. Build and deploy the status page:
     ```bash
     vp run --filter status-page build
     vp exec --filter status-page -- wrangler deploy --config dist/server/wrangler.json
     ```

## SSR and hydration safety

To avoid React hydration errors, such as minified `#418`, keep server-rendered output deterministic in `apps/status-page`:

- Don't render `Date.now()`, `new Date()`, `Math.random()`, or locale-dependent formatting during SSR.
- Prefer one "now" snapshot from loader/state, such as `state.lastUpdate`, and pass it down.
- If you must format dates, use a fixed timezone (UTC) or a deterministic helper.
- For browser-only behavior (localStorage/window), gate on `useHydrated()`.

Quick sanity check (production-like local runtime):

```bash
vp run status-page-build
vp exec --filter status-page -- wrangler dev --local --config dist/server/wrangler.json --port 3000 --persist-to .wrangler/state
```

## Uninstall

To remove a FlareWatch deployment entirely:

```bash
vp exec --filter worker -- wrangler delete flarewatch-worker
vp exec --filter status-page -- wrangler delete flarewatch
vp exec --filter worker -- wrangler kv namespace delete --namespace-id "<flarewatch-state-id>"
```

Deleting the KV namespace permanently removes all uptime history. Find its ID with `wrangler kv namespace list`.

## Migrating From Pulumi

Older deployments created the monitoring Worker as `${projectName}_worker`, the status page as `${projectName}`, and the KV namespace as `${projectName}_kv`. Wrangler now deploys `flarewatch-worker`, `flarewatch`, and `flarewatch-state`.

To keep your existing uptime history, rename the old `${projectName}_kv` namespace to `flarewatch-state` **before** the first Wrangler deploy (dashboard → Storage & Databases → KV, or the namespace update API). Renaming keeps the namespace ID, so the running Workers are unaffected and the deploy workflow adopts it instead of creating an empty one.

The old `CUSTOM_DOMAIN` / `CUSTOM_DOMAIN_ZONE_ID` secrets are no longer read. An existing custom domain stays attached to its Worker; after migrating, confirm it points at the `flarewatch` Worker, and manage it from the dashboard or by uncommenting the route in `apps/status-page/wrangler.jsonc` (the API token then also needs `Zone → Workers Routes → Edit`).

After the new Wrangler deployment is healthy, remove old Pulumi resources you no longer use (skip the KV commands if you renamed the namespace above):

```bash
vp exec --filter worker -- wrangler delete "${PROJECT_NAME}_worker"
vp exec --filter status-page -- wrangler delete "$PROJECT_NAME"
vp exec --filter worker -- wrangler kv namespace list
vp exec --filter worker -- wrangler kv namespace delete --namespace-id "<old-${PROJECT_NAME}_kv-id>"
```

Only delete the old status page Worker if it is not the same `flarewatch` Worker now managed by Wrangler. If you created an R2 bucket only for the old state backend, delete that bucket from Cloudflare after you no longer need the state history.
