# 0002. The monitor Worker trusts its service binding

- **Status:** accepted
- **Date:** 2026-10-03
- **Deciders:** @saminnet

## Context

The monitor Worker serves routes that change state: trigger a check run, run one check now,
read and edit the hub, accept heartbeat pings. None of them checks who is calling. The status
page reaches the Worker through its `MONITOR_WORKER` service binding, and the Worker has no
address of its own. Security audits flag the missing check on every run, because an auditor
cannot see the account settings that keep the Worker private.

## Decision

The Worker keeps no auth of its own. Its only caller is the status page's service binding.
Three settings in `services/worker/wrangler.toml` hold that: `workers_dev = false`,
`preview_urls = false`, and no `routes`. A test in `services/worker/tests/config.test.ts` fails
when any of them changes. A change that gives the Worker an address, through a route, a custom
domain or workers.dev, must add an auth check to its fetch handler first.

A shared secret between the two Workers was rejected. It adds a secret to every fork's setup, and
it guards against a misconfiguration the test already catches.

## Consequences

- An auditor can close the "no auth on the monitor Worker" lead from this ADR and the test, with
  no account access.
- The status page is the only public surface. Its own auth and rate limits are the ones that
  matter.
- Anyone who routes the Worker publicly without an auth check exposes every route. The test and
  the comment in the fetch handler are the two warnings.
