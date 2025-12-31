# Contributing

Thanks for helping improve FlareWatch.

## Development setup

See [DEVELOPMENT.md](DEVELOPMENT.md) for commands and local setup.

## Tests

If you're adding a feature or fixing a bug, a test supporting the change is appreciated.

Run tests with:

```bash
pnpm test                      # all tests
pnpm -F worker test            # worker only
pnpm -F status-page test       # status page only
pnpm -F @flarewatch/proxy test # proxy only
```

## What goes where

- Uptime checks and state: `services/worker`
- Status page UI: `apps/status-page`
- User-editable config: `packages/config`
- Shared types: `packages/shared`
- Infrastructure (Pulumi): `infra`
- Optional proxy: `services/proxy`
