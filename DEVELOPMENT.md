# Development

FlareWatch uses Vite+ (`vp`) for installs, checks, tests and builds.

```bash
vp install
vp config          # once, for the pre-commit hook

vp check           # format, lint and types
vp run test        # unit tests
vp run build       # both Workers
```

Browser tests start two local status pages, one public and one private:

```bash
cd apps/status-page && vp exec playwright test
```

## Layout

| Path                | Holds                                                         |
| ------------------- | ------------------------------------------------------------- |
| `services/worker`   | The monitor Worker: checks, the hub, alerts, heartbeat pings. |
| `apps/status-page`  | The status page Worker, a TanStack Start app.                 |
| `packages/config`   | The user's config: monitors, alerts, page settings.           |
| `packages/shared`   | Types and helpers both Workers use.                           |
| `.github/workflows` | CI and the deploy workflow.                                   |

The monitor Worker keeps incidents, latency, heartbeat pings and maintenance windows in the hub, a SQLite Durable Object in `services/worker/src/hub`. The status page reads and edits it through its `MONITOR_WORKER` service binding. KV (`FLAREWATCH_STATE`) holds sign-in sessions. The hub also reads a 1.x deployment's data from KV, once, on its first start.

## Run it locally

Run both Workers in one process, the status page first:

```bash
vp run status-page-build
cp apps/status-page/.dev.vars.example apps/status-page/.dev.vars
vp exec --filter status-page -- wrangler dev --local --config dist/server/wrangler.json --config ../../services/worker/wrangler-dev.toml --port 3000 --persist-to .wrangler/state
```

Open <http://localhost:3000>. The first page load starts a check run, and data shows a few seconds later. For UI work alone, `vp run dev-status-page` is faster, but without the monitor Worker it shows no data.

## Lint rules

Linting includes the anti-slop rules in `tools/oxlint/anti-slop/`, from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) plus a few local ones. They live with their tests in another repository, so don't edit the copy here. If a rule misfires, open an issue. `vite.config.ts` lists the rules that run.

Oxlint's type-aware `no-unsafe-*`, `no-floating-promises` and `no-misused-promises` checks run as errors, tests included. Fix findings by restructuring first. A type assertion that survives review needs a `SAFETY:` comment stating the checked invariant.

## SSR and hydration safety

The status page renders on the server, then React hydrates it in the browser. Different output on the two sides causes hydration errors such as minified `#418`. Keep server output deterministic:

- Don't render `Date.now()`, `new Date()`, `Math.random()` or locale formatting during SSR.
- Take one "now" from the loader or the state, such as `state.lastUpdate`, and pass it down.
- Format dates in UTC with the helpers in `src/lib/date.ts` or `formatUtcShort`.
- Gate browser-only code (`localStorage`, `window`) on `useHydrated()`.

## Deploy by hand

GitHub Actions deploys normally (see [docs/deploy.md](docs/deploy.md)). To deploy from your machine:

```bash
vp exec --filter worker -- wrangler kv namespace create flarewatch-state
```

Put the namespace ID in place of `__FLAREWATCH_STATE_KV_NAMESPACE_ID__` in `services/worker/wrangler.toml` and `apps/status-page/wrangler.jsonc`. Then:

```bash
vp exec --filter worker -- wrangler deploy --config wrangler.toml
vp run --filter status-page build
vp exec --filter status-page -- wrangler deploy --config dist/server/wrangler.json
```

The status page deploys from `dist/server/wrangler.json`, which the build generates from `wrangler.jsonc`.

Coming from a Pulumi deploy from before 1.0? Follow [the 1.1.0 migration guide](https://github.com/saminnet/flarewatch/blob/v1.1.0/DEVELOPMENT.md#migrating-from-pulumi) first.
