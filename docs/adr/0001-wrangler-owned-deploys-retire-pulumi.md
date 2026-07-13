# 0001. Wrangler owns self-deploys; retire Pulumi

- **Status:** accepted
- **Date:** 2026-07-02
- **Deciders:** Samin Yousefnia

## Context

The self-deploy path was fork → GitHub Actions → Pulumi, with Pulumi state in an R2 bucket.
Every forker had to configure five GitHub secrets across three credential types — three of them
existed only to serve Pulumi's state backend, and the R2 requirement meant a card on file, which
undercut the "runs free on Cloudflare" pitch. The repo also half-supported wrangler (local-dev
grade configs in both workers), so two visible deploy models confused newcomers.

The resource topology is tiny: one KV namespace, a monitor worker with a 1-minute cron, and a
status-page worker. Declarative state management buys little at this scale, and the Cloudflare
templates gallery and "Deploy to Cloudflare" tooling require wrangler-native config anyway.

## Decision

Wrangler owns production deploys; Pulumi is removed entirely. The wrangler configs are promoted
to production grade (cron trigger, KV bindings, service binding, routing), CI runs two ordered
`wrangler deploy`s (monitor worker first), and the KV namespace is created or adopted by title
(`flarewatch-state`). Required secrets drop from five to two: `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`.

Keeping Pulumi as a documented alternative was rejected: it would preserve the doc sprawl and
drift this decision exists to kill. The status quo would keep five-secret, card-on-file
onboarding as the only free path.

## Consequences

- Fork setup is two secrets and one credential type; no R2 bucket, card on file, or passphrase.
- Standard tooling for the self-hosting Cloudflare audience; unlocks the templates-gallery
  submission and future one-click deploy work.
- Accepted cost: no declarative diff, rollback, or delete — renamed or removed resources leave
  orphans to clean up by hand. At six resources this is acceptable.
- Accepted cost: KV namespace creation is a one-time out-of-band step until wrangler
  auto-provisioning covers it; CI must encode the two-worker deploy ordering.
- Existing Pulumi-deployed instances keep running, but the resource names change
  (`${projectName}_worker`/`${projectName}_kv` → `flarewatch-worker`/`flarewatch-state`), so
  preserving state requires renaming the KV namespace before the first wrangler deploy — see
  DEVELOPMENT.md § Migrating From Pulumi.
