# Status Page (`apps/status-page`)

The FlareWatch status page is a TanStack Start app deployed as a Cloudflare Worker.

It serves:

- The public UI (dashboard, history, embed)
- Public JSON/SVG APIs under `/api/*`
- An optional admin UI for managing scheduled maintenances

## Required binding

- `FLAREWATCH_STATE` (Cloudflare KV binding)
  - Must point to the same KV namespace the monitoring worker (`services/worker`) writes to.

## Optional auth (recommended)

These are Worker secrets. Do not commit them.

- `FLAREWATCH_STATUS_PAGE_BASIC_AUTH='<output of vp run auth:secret -- <username> "<password>">'`
  - Protects the entire status page.
- `FLAREWATCH_ADMIN_BASIC_AUTH='<output of vp run auth:secret -- <username> "<password>">'`
  - Enables and protects `/admin` and `/api/admin/*` with an in-app login, session cookie, and logout button.
  - In production, if unset: `/admin` returns `404` and `/api/admin/*` returns `403`. In dev, admin is allowed without creds.

Generate these values from a username and password:

```bash
# From repo root:
vp run auth:secret -- <username> 'replace-with-strong-password'
```

Run once per secret and copy the full JSON output into your Worker secret or GitHub Secret. Do not edit JSON fields manually.

Browsers cache Basic Auth credentials for the session. This applies to `FLAREWATCH_STATUS_PAGE_BASIC_AUTH`. To log out, close the tab/window or use a private window.

## Local development

### UI-only dev (fast)

```bash
vp run dev-status-page
```

This runs the Vite dev server. KV-backed routes (`/api/*`) return "No data available" until the monitoring worker writes state.

### Full local stack

1. Start the monitoring worker and trigger a check:

```bash
vp run dev-worker
curl http://localhost:8787/__scheduled
```

2. Run the status page in the Workers runtime:

```bash
vp run status-page-build
cp apps/status-page/.dev.vars.example apps/status-page/.dev.vars
vp exec --filter status-page -- wrangler dev --local --config dist/server/wrangler.json --port 3000 --persist-to .wrangler/state
```

Open `http://localhost:3000`.

## APIs

### Public APIs

- `GET /api/data` - current status for all monitors (CORS enabled)
- `GET /api/maintenances` - scheduled maintenances from KV (CORS enabled)
- `GET /api/badge?id=<monitor_id>` - SVG badge for a monitor

CORS is controlled by `pageConfig.apiCorsOrigins` in `packages/config/src/public.ts`. If unset, it defaults to `*`.

### Admin APIs

- `GET /api/admin/maintenances`
- `POST /api/admin/maintenances`
- `PUT /api/admin/maintenances`
- `DELETE /api/admin/maintenances`

Requires `FLAREWATCH_ADMIN_BASIC_AUTH`.

## Deployment notes

`apps/status-page/wrangler.jsonc` is the source config. The Cloudflare Vite plugin emits `dist/server/wrangler.json` during the build, and production deploys use that generated config.

Before a manual deploy, replace the `__FLAREWATCH_STATE_KV_NAMESPACE_ID__` placeholder in `wrangler.jsonc` with your real KV namespace ID (CI does this automatically — see DEVELOPMENT.md for the namespace creation step).

```bash
vp run --filter status-page build
vp exec --filter status-page -- wrangler deploy --config dist/server/wrangler.json
```
