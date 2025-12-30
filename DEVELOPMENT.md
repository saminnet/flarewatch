# Development

Developer notes for working on FlareWatch locally.

## Commands

```bash
pnpm install

# Dev
pnpm dev
pnpm worker:dev
pnpm proxy:dev

# Quality
pnpm format:check
pnpm lint
pnpm compile

# Builds (used by CI and Pulumi)
pnpm worker:build
pnpm build
```

## Architecture (high level)

- `services/worker` runs scheduled checks and writes state to KV (`FLAREWATCH_STATE` binding).
- `apps/status-page` reads the same KV state and renders the UI; deployed to Cloudflare Workers.
- `/admin` (optional) manages maintenances stored in the same KV under the `maintenances` key.
- `services/proxy` is optional and executes checks from custom locations (private networks, TCP, SSL).

## Deploy model

All resources are managed by Pulumi:

| Resource           | Notes                                           |
| ------------------ | ----------------------------------------------- |
| KV namespace       | Shared by monitoring worker and status page     |
| Monitoring Worker  | Reads built bundle from `services/worker/dist`  |
| Cron trigger       | Attached to monitoring Worker (every minute)    |
| Status page Worker | Reads built bundle from `apps/status-page/dist` |

**Important:** Do NOT use `wrangler deploy` for production. The `wrangler.toml` files are for local development only.

## Configuration

- Worker: `packages/config/src/worker.ts` (examples: `packages/config/src/worker.example.ts`)
- Status page: `packages/config/src/public.ts` (examples: `packages/config/src/public.example.ts`)

## Secrets / environment

All secrets are managed via Pulumi config:

- `PULUMI_CONFIG_PASSPHRASE` - Required for local backends like R2
- `proxyToken` - Optional proxy auth token
- `statusPageBasicAuth` - Optional Basic Auth for status page (`<username>:<password>`)
- `adminBasicAuth` - Optional Basic Auth for admin routes (`<username>:<password>`)

Set secrets with:

```bash
pulumi -C infra config set --secret proxyToken
pulumi -C infra config set --secret statusPageBasicAuth
pulumi -C infra config set --secret adminBasicAuth
```

Pulumi prompts you for the value. For Basic Auth, use the format `<username>:<password>`.

## Deployment

- Recommended: GitHub Actions (`.github/workflows/deploy.yml`)
- Manual:
  1. Install the Pulumi CLI (version in `.pulumi.version`)
  2. Build everything:
     ```bash
     pnpm worker:build
     pnpm build
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
     pnpm infra:up
     ```

## SSR / Hydration safety (status page)

To avoid React hydration errors (e.g. minified `#418`) in `apps/status-page`, keep server-rendered output deterministic:

- Don’t render `Date.now()`, `new Date()`, `Math.random()`, or locale-dependent formatting during SSR.
- Prefer a single “now” snapshot from loader/state (e.g. `state.lastUpdate`) and pass it down.
- If you must format dates, use a fixed timezone (UTC) or a deterministic helper.
- For browser-only behavior (localStorage/window), gate on `useHydrated()`.

Quick sanity check (production-like local runtime):

```bash
pnpm -F status-page build
pnpm -C apps/status-page exec wrangler dev --local --config dist/server/wrangler.json --port 3000 --persist-to .wrangler/state
```

## Destroying Infrastructure

All resources are managed by Pulumi. Simply run:

```bash
pnpm infra:destroy
```
