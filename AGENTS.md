# AGENTS.md

See [README.md](README.md) for what FlareWatch is, [DEVELOPMENT.md](DEVELOPMENT.md) for commands and layout, and [CONTEXT.md](CONTEXT.md) for the terms the code and docs use.

- Use `vp` (Vite+), not `pnpm`, for scripts: `vp check`, `vp run test`, `vp run build`.
- Wrangler owns production deploys. Keep `services/worker/wrangler.toml` and `apps/status-page/wrangler.jsonc` deployable as committed.
- `apps/status-page` renders on the server. Keep its output deterministic: no `Date.now()`, `Math.random()` or locale formatting. See DEVELOPMENT.md, SSR and hydration safety.
- The hub in `services/worker/src/hub` runs on the Workers Free plan: 5 million rows read and 100,000 rows written a day. A query that runs on every check run or page view must not read the whole history.
- A link hover must not add a server call or a KV read. A client navigation must not add one while the cached data is fresh. The router preloads a route when a link is hovered. A cached failure must expire.
- After a UI change in `apps/status-page`, run `vp check` and fix each `shadcn` finding.
- Fix a lint or type finding in the code. Never add an `oxlint-disable`, `eslint-disable`, `@ts-ignore` or `@ts-expect-error` comment.
- Never widen a `shadcn/*` contract, add a lint override or turn a rule off without Samin's approval. Give the reason in the pull request.
- Before you add a variant in `components/ui`, check that no existing variant, size or theme token does the job.
- Seed data in `apps/status-page/scripts/seed-e2e.ts` must read like a real status page. A test that needs hostile input must create it and delete it.
- Hub migrations in `schema.ts` only grow. Append a step. Never edit a shipped one. A step runs in the hub's constructor and blocks its first request. A step that rewrites rows must page through them and bound what it keeps, as step 7 does.
