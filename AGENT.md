# AGENT.md

Read [README.md](README.md) for project overview and [DEVELOPMENT.md](DEVELOPMENT.md) for commands, architecture, and local setup.

## Agent Notes

- Use `vp` (Vite+) for scripts, not direct `pnpm` script calls. Examples: `vp check`, `vp run build`, `vp run test`.
- Do not use `wrangler deploy` for production. Pulumi owns deploys; `wrangler.toml` is for local development.
- `apps/status-page` is SSR. Keep rendered server output deterministic: avoid `Date.now()`, `Math.random()`, and locale-dependent formatting during render.
- Keep changes narrow and follow the existing package boundaries under `apps/`, `services/`, `packages/`, and `infra/`.
