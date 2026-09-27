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

| Path                | Holds                                                       |
| ------------------- | ----------------------------------------------------------- |
| `services/worker`   | The monitor Worker: checks, state, alerts, heartbeat pings. |
| `apps/status-page`  | The status page Worker, a TanStack Start app.               |
| `packages/config`   | The user's config: monitors, alerts, page settings.         |
| `packages/shared`   | Types and helpers both Workers use.                         |
| `.github/workflows` | CI and the deploy workflow.                                 |

Both Workers share one KV namespace through the `FLAREWATCH_STATE` binding. The monitor Worker writes `state`, the status page reads it, and maintenance windows live under `maintenances`.

## Run it locally

Start the monitor Worker and trigger a run:

```bash
vp run dev-worker
curl http://localhost:8787/__scheduled
```

It saves state where the status page can read it. Then run the status page in the Workers runtime:

```bash
vp run status-page-build
cp apps/status-page/.dev.vars.example apps/status-page/.dev.vars
vp exec --filter status-page -- wrangler dev --local --config dist/server/wrangler.json --port 3000 --persist-to .wrangler/state
```

Open <http://localhost:3000>. For UI work alone, `vp run dev-status-page` is faster, but it shows no data until the monitor Worker has run.

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
