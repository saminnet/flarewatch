# AGENTS.md

See [README.md](README.md) for what FlareWatch is, [DEVELOPMENT.md](DEVELOPMENT.md) for commands and layout, and [CONTEXT.md](CONTEXT.md) for the terms the code and docs use.

- Use `vp` (Vite+), not `pnpm`, for scripts: `vp check`, `vp run test`, `vp run build`.
- Wrangler owns production deploys. Keep `services/worker/wrangler.toml` and `apps/status-page/wrangler.jsonc` deployable as committed.
- `apps/status-page` renders on the server. Keep its output deterministic: no `Date.now()`, `Math.random()` or locale formatting. See DEVELOPMENT.md, SSR and hydration safety.
- The hub in `services/worker/src/hub` runs on the Workers Free plan: 5 million rows read and 100,000 rows written a day. A query that runs on every check run or page view must not read the whole history.
- Hub migrations in `schema.ts` only grow. Append a step; never edit a shipped one. A step runs in the hub's constructor and blocks its first request. A step that rewrites rows must page through them and bound what it keeps, as step 7 does.
