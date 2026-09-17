# 0002. Vendored anti-slop lint rules

- **Status:** accepted
- **Date:** 2026-09-17
- **Deciders:** Samin Yousefnia

## Context

Agents write most of the TypeScript in this repo, and their habits show up in review: chained
`as unknown as` casts, widened annotations on values TS already inferred, `Record<string, unknown>`
where a contract should be, and type assertions that hide unvalidated JSON. These patterns pass the
compiler and fail in production, so they need to fail in CI instead.

The curated ruleset for this is the anti-slop oxlint plugin: a vendored subset of
[dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), kept as a reference copy in the
ai-memory-lane repo and documented in `~/.agents/docs/anti-slop-baseline.md`. FlareWatch lints
through vite-plus, and `vp lint` is oxlint under the hood, so the plugin rides the existing
`vp check` gate that CI and the pre-commit hook already run. No second linter is added.

## Decision

Vendor the plugin at `tools/oxlint/anti-slop/` (10 rules) from the ai-memory-lane reference copy,
and enable every rule as `error` in `vite.config.ts`. Tests are exempt from
`require-safety-comment-for-type-assertion` only. The vendor directory is excluded from linting and
stays byte-identical to the reference copy so future propagation stays diffable.

Versioning: the oxlint that executes the rules is pinned inside vite-plus (1.82.0 at adoption).
`@oxlint/plugins` is a direct devDependency floating at latest, because it is an authoring-time
API library; vite-plus itself pairs oxlint 1.82 with plugins 1.79, so strict lockstep is not
required. After any vite-plus bump, confirm the vendored rules still load and fire.

Backfill policy: fix findings by restructuring (named types, `satisfies`, validation at the
boundary) rather than annotating. A `SAFETY:` comment is the last resort for an assertion whose
invariant TypeScript cannot express, and it must state that invariant. Rules are never downgraded
or scoped away to make findings disappear. A rule that misfires on a legitimate idiom is re-curated
in the reference repo first, then propagated here.

Rejected: installing upstream as a dependency (none is published; the project is vendored by
design), and pinning `@oxlint/plugins` to the embedded oxlint version (unnecessary, and it would
need a renovate ignore to hold).
