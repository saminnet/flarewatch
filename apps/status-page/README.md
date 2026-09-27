# Status Page (`apps/status-page`)

The FlareWatch status page is a TanStack Start app deployed as a Cloudflare Worker.

It serves:

- The public UI (dashboard, history, embed)
- Public JSON/SVG APIs under `/api/*`
- An optional operator sign-in (`/login`). Signed in, the same pages show private monitors, and Events gets maintenance editing.

## Required binding

- `FLAREWATCH_STATE` (Cloudflare KV binding)
  - Must point to the same KV namespace the monitoring worker (`services/worker`) writes to.

## Optional auth (recommended)

These are Worker secrets. Do not commit them.

- `FLAREWATCH_ADMIN_BASIC_AUTH='<output of vp run auth:secret -- <username> "<password>">'`
  - Enables sign-in at `/login` with a session cookie. Signed-in pages are sent with `Cache-Control: private, no-store`.
  - Protects `/api/admin/*`. Scripts can call it with the same credentials in a Basic `Authorization` header.
  - In production, if unset: `/login` says sign-in is not set up and `/api/admin/*` returns `403`. In dev, everyone is signed in.

Generate these values from a username and password:

```bash
# From repo root:
vp run auth:secret -- <username> 'replace-with-strong-password'
```

Copy the full JSON output into your Worker secret or GitHub Secret. Do not edit JSON fields manually.

To keep the whole page private, set `visibility: 'private'` in `packages/config/src/public.ts`. Visitors then get only the sign-in page. A leftover `FLAREWATCH_STATUS_PAGE_BASIC_AUTH` secret, which this setting replaces, also keeps the page private-only.

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
