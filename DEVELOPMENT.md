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

# Builds (used by CI and Pulumi)
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

## Deployment model

All resources are managed by Pulumi:

| Resource           | Notes                                           |
| ------------------ | ----------------------------------------------- |
| KV namespace       | Shared by monitoring worker and status page     |
| Monitoring Worker  | Reads built bundle from `services/worker/dist`  |
| Cron trigger       | Attached to monitoring Worker (every minute)    |
| Status page Worker | Reads built bundle from `apps/status-page/dist` |

Do not use `wrangler deploy` for production. The `wrangler.toml` files are for local development only.

## Configuration

- Worker: `packages/config/src/worker.ts` (examples: `packages/config/src/worker.example.ts`)
- Status page: `packages/config/src/public.ts` (examples: `packages/config/src/public.example.ts`)

## Secrets

See [infra/README.md](infra/README.md#optional-secrets) for Pulumi secret configuration.

## Deployment

- Recommended: GitHub Actions (`.github/workflows/deploy.yml`)
- Manual:
  1. Install the Pulumi CLI (version in `.pulumi.version`)
  2. Build everything:
     ```bash
     vp run build
     ```
  3. Configure Pulumi:
     ```bash
     pulumi -C infra login "$PULUMI_BACKEND_URL"
     pulumi -C infra stack select production --create
     pulumi -C infra config set accountId "$CLOUDFLARE_ACCOUNT_ID"
     pulumi -C infra config set projectName "<your-name>"
     ```
  4. Deploy:
     ```bash
     vp run infra:up
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

## Destroying infrastructure

All resources are managed by Pulumi:

```bash
vp run infra:destroy
```
