# Monitoring Worker (`services/worker`)

The FlareWatch monitoring worker is a Cloudflare Worker. It runs scheduled checks and writes the latest state to Cloudflare KV.

## What it does

- Runs on a 1-minute cron schedule (provisioned by `infra/`).
- Reads monitors from `packages/config/src/worker.ts`.
- Writes the current state to KV key `state`.
- Reads maintenance windows from KV key `maintenances`.
- Supports an internal-only `/trigger` call through a service binding. There is no public endpoint.

## Required binding

- `FLAREWATCH_STATE` (Cloudflare KV binding)

## Optional secrets

- `FLAREWATCH_PROXY_TOKEN` - bearer token used when a monitor uses a self-hosted check proxy.

## Local development

```bash
vp run dev-worker
```

This runs `wrangler dev` with:

- `--test-scheduled`, so you can trigger a run at `http://localhost:8787/__scheduled`
- `--persist-to ../../apps/status-page/.wrangler/state`, so the status page can read the same local KV state

Trigger a run:

```bash
curl http://localhost:8787/__scheduled
```

## Build and deploy

- `vp run worker-build` builds a bundle to `services/worker/dist/` (used by Pulumi).
- `vp exec --filter worker -- wrangler deploy` deploys the worker directly with Wrangler (optional; CI deploys via Pulumi).
