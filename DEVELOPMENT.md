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

FlareWatch and flarewatch-proxy share three fixture files. The proxy keeps them in `cmd/flarewatch-proxy/testdata`, and each copy here must match it byte for byte. A change to a file, or to the code it tests, needs the same change in both repos.

| File                   | Copy in                          | Says                                    | Run by                                            |
| ---------------------- | -------------------------------- | --------------------------------------- | ------------------------------------------------- |
| `http-assertions.json` | `packages/shared/tests/fixtures` | which error an HTTP reply gives         | `packages/shared/tests/http-assertions.test.ts`   |
| `requests.json`        | `packages/shared/tests/fixtures` | which monitors the proxy accepts        | `packages/shared/tests/proxy-requests.test.ts`    |
| `verdicts.json`        | `services/worker/tests/fixtures` | how a check ends against a given target | `services/worker/tests/checkers/verdicts.test.ts` |

The last two tests each hold a short table of the cases where FlareWatch and the proxy differ, with the reason. The verdicts test runs the Worker's own check in a local workerd, started with wrangler's `unstable_startWorker`. wrangler's test harness would send the Worker's requests out through Node, and Node handles redirects and gzip differently.

## Layout

| Path                | Holds                                                         |
| ------------------- | ------------------------------------------------------------- |
| `services/worker`   | The monitor Worker: checks, the hub, alerts, heartbeat pings. |
| `apps/status-page`  | The status page Worker, a TanStack Start app.                 |
| `packages/config`   | The user's config: monitors, alerts, page settings.           |
| `packages/shared`   | Types and helpers both Workers use.                           |
| `.github/workflows` | CI and the deploy workflow.                                   |

The monitor Worker keeps incidents, latency, heartbeat pings and maintenance windows in the hub, a SQLite Durable Object in `services/worker/src/hub`. The status page reads and edits it through its `MONITOR_WORKER` service binding. KV (`FLAREWATCH_STATE`) holds sign-in sessions.

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

## Changelog

A pull request that changes behavior adds an entry to `CHANGELOG.md` under the next version. Write it for someone upgrading.

## Deploy by hand

GitHub Actions deploys normally (see [docs/deploy.md](docs/deploy.md)). To deploy from your machine:

```bash
vp exec --filter worker -- wrangler kv namespace create flarewatch-state
```

Put the namespace ID in place of `__FLAREWATCH_STATE_KV_NAMESPACE_ID__` in `apps/status-page/wrangler.jsonc`, then deploy:

```bash
vp exec --filter worker -- wrangler deploy --config wrangler.toml
vp run --filter status-page build
vp exec --filter status-page -- wrangler deploy --config dist/server/wrangler.json
```

The status page deploys from `dist/server/wrangler.json`, which the build generates from `wrangler.jsonc`.
