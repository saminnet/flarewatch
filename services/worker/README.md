# Monitoring Worker (`services/worker`)

The FlareWatch monitoring worker is a **Cloudflare Worker** that runs scheduled checks (cron) and writes the latest state to **Cloudflare KV**.

## What it does

- Runs on a 1-minute cron schedule (provisioned by `infra/`).
- Reads monitors from `packages/config/src/worker.ts`.
- Writes the current state to KV key `state`.
- Reads KV key `maintenances` to avoid flagging downtime during scheduled maintenance windows.

## Required binding

- `FLAREWATCH_STATE` (Cloudflare KV binding)

## Optional secrets

- `FLAREWATCH_PROXY_TOKEN` — bearer token used when a monitor is configured with a self-hosted check proxy.

## Local development

```bash
pnpm worker:dev
```

This runs `wrangler dev` with:

- `--test-scheduled` (so you can trigger a run by visiting `http://localhost:8787/__scheduled`)
- `--persist-to ../../apps/status-page/.wrangler/state` (so the status page can read the same local KV state)

Trigger a run:

```bash
curl http://localhost:8787/__scheduled
```

## Build & deploy

- `pnpm worker:build` builds a bundle to `services/worker/dist/` (used by Pulumi).
- `pnpm -F worker deploy:wrangler` deploys the worker directly with Wrangler (optional; CI deploys via Pulumi).
