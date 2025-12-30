# Contributing

Thanks for helping improve FlareWatch.

## Development setup

- Node.js 24+
- pnpm 10+

```bash
pnpm install
pnpm dev
```

## Quality checks

Run these before opening a PR:

```bash
pnpm format:check
pnpm lint
pnpm compile
```

## What goes where

- Uptime checks and state: `services/worker`
- Status page UI: `apps/status-page`
- User-editable config: `packages/config`
- Shared types: `packages/shared`
- Infrastructure (Pulumi): `infra`
- Optional proxy: `services/proxy`
