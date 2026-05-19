# CLAUDE.md

See [README.md](README.md) for what this project is, and [DEVELOPMENT.md](DEVELOPMENT.md) for commands and architecture.

## Gotchas

- Use `vp` (Vite+), not `pnpm`, for scripts. E.g. `vp run build`, `vp check`.
- Never use `wrangler deploy` for production. Pulumi owns deploys; `wrangler.toml` is local-dev only.
- `apps/status-page` is SSR — keep server output deterministic (no `Date.now()`, `Math.random()`, locale formatting). See DEVELOPMENT.md § SSR and hydration safety.
