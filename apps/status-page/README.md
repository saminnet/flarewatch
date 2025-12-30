# Status Page (`apps/status-page`)

The FlareWatch status page is a TanStack Start app deployed as a **Cloudflare Worker**.

It serves:

- The public UI (dashboard, history, embed)
- Public JSON/SVG APIs under `/api/*`
- An optional admin UI for managing scheduled maintenances

## Required binding

- `FLAREWATCH_STATE` (Cloudflare KV binding)
  - Must point to the same KV namespace the monitoring worker (`services/worker`) writes to.

## Optional auth (recommended)

These are **Worker secrets** (not in git):

- `FLAREWATCH_STATUS_PAGE_BASIC_AUTH="<username>:<password>"`
  - Protects the entire status page.
- `FLAREWATCH_ADMIN_BASIC_AUTH="<username>:<password>"`
  - Enables and protects `/admin` and `/api/admin/*`.
  - If unset: `/admin` returns `404` and `/api/admin/*` returns `403`.

Note: browsers cache Basic Auth credentials for the session. To “log out”, close the tab/window or use a private window.

## Local development

### UI-only dev (fast)

```bash
pnpm dev
```

This runs Vite dev server. KV-backed routes (`/api/*`) will return “No data available” until the monitoring worker writes state.

### Full local stack (KV + cron + auth)

1. Start the monitoring worker and trigger a check:

```bash
pnpm worker:dev
curl http://localhost:8787/__scheduled
```

2. Run the status page in the Workers runtime:

```bash
pnpm -F status-page build
cp apps/status-page/.dev.vars.example apps/status-page/.dev.vars
pnpm -C apps/status-page exec wrangler dev --local --config dist/server/wrangler.json --port 3000 --persist-to .wrangler/state
```

Open `http://localhost:3000`.

## APIs

### Public

- `GET /api/data` — current status for all monitors (CORS enabled)
- `GET /api/maintenances` — scheduled maintenances from KV (CORS enabled)
- `GET /api/badge?id=<monitor_id>` — SVG badge for a monitor

CORS is controlled by `pageConfig.apiCorsOrigins` in `packages/config/src/public.ts`. If unset, it defaults to `*`.

### Admin

- `GET /api/admin/maintenances`
- `POST /api/admin/maintenances`
- `PUT /api/admin/maintenances`
- `DELETE /api/admin/maintenances`

Requires `FLAREWATCH_ADMIN_BASIC_AUTH`.

## Deployment notes

`apps/status-page/wrangler.jsonc` exists for local development.

Production deployments are managed by Pulumi (`infra/`). Pulumi reads the build outputs from:

- `apps/status-page/dist/server/index.js` (Worker bundle)
- `apps/status-page/dist/client` (static assets)

So there is no KV-ID “injection” step, and you should not `wrangler deploy` this app for production.

### Manual deploy (Pulumi)

```bash
pnpm worker:build
pnpm -F status-page build

pulumi -C infra login "$PULUMI_BACKEND_URL"
pulumi -C infra stack select production --create
pulumi -C infra up
```
