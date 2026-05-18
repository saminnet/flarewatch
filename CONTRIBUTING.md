# Contributing

Thanks for helping with FlareWatch.

## Development setup

See [DEVELOPMENT.md](DEVELOPMENT.md) for commands and local setup.

## Tests

If you add a feature or fix a bug, include a focused test when it makes sense.

Run tests with:

```bash
vp run test                    # all tests
vp run worker-test             # worker only
vp run status-page-test        # status page only
```

## What goes where

- Uptime checks and state: `services/worker`
- Status page UI: `apps/status-page`
- User-editable config: `packages/config`
- Shared types: `packages/shared`
- Infrastructure (Pulumi): `infra`
- Optional proxy (external repo): `https://github.com/saminnet/flarewatch-proxy`
