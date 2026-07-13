# Monitoring Worker (`services/worker`)

The FlareWatch monitoring worker is a Cloudflare Worker. It runs scheduled checks and writes the latest state to Cloudflare KV.

## What it does

- Runs on a 1-minute cron schedule configured in `wrangler.toml`.
- Reads monitors from `packages/config/src/worker.ts`.
- Writes the current state to KV key `state`.
- Reads maintenance windows from KV key `maintenances`.
- Supports an internal-only `/trigger` call through a service binding. There is no public endpoint.

## Required binding

- `FLAREWATCH_STATE` (Cloudflare KV binding)

## Optional secrets

- `FLAREWATCH_PROXY_TOKEN` - bearer token used when a monitor uses a check proxy.

## Proxy checks

Monitors can set `checkProxy` to send checks through a proxy endpoint. By default, a proxy failure marks the monitor check as failed. Set `checkProxyFallback: true` on that monitor to try the direct Worker check after the proxy fails.

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

- `vp run worker-build` validates the Worker bundle with `wrangler deploy --dry-run`.
- `vp exec --filter worker -- wrangler deploy --config wrangler.toml` deploys the worker with Wrangler.
