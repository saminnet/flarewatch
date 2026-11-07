# 0003. Lifecycles are explicit state machines

- **Status:** accepted
- **Date:** 2026-11-07
- **Deciders:** @saminnet

## Context

The hub tracked each lifecycle in flags and nullable columns. A flag gated another flag, and the
rules sat across many SQL statements. An audit found nine implicit state machines in the worker
and six in the status page. Bugs in this area came from a state that no code named, such as a
relapse in the recovery hold.

## Decision

Logic that tracks a lifecycle has an explicit state enum and a pure step function:
`next = step(state, event)`.

- The machines of the hub are in `services/worker/src/hub`: `down-alert-lifecycle.ts`,
  `expiry-lifecycle.ts`, `failure-streak.ts`, `follow-up-lifecycle.ts`, `incident-lifecycle.ts`,
  `recovery-lifecycle.ts`, `subscriber-notices.ts` and `subscriber-outbox.ts`.
- A step function ends its switch on the event with a `never` check. A new event does not compile
  until each machine handles it.
- Each event has a production caller. Remove an event that only a test sends.
- A write to a lifecycle column takes its value from the step function. The write stays in the
  file that calls the step function.
- A test replays a captured event log through the machines.
- A status page state with two or more fields that change together uses one status union and a
  reducer.

Three things are not machines:

- A filter or a sequence with one path.
- Bulk SQL that changes a set of rows. A step function needs one read per row, and the Workers
  Free plan allows 5 million rows read a day. The bulk statement stays outside the machine.
- A single independent value, such as the text of an input.

## Consequences

- `services/worker/tests/hub/lifecycle-writers.test.ts` lists each file that writes each column
  of the lifecycle tables. A new writer or a new column fails the test until a person adds it to
  the list. That change is the moment to check that the write uses a step function.
- The `never` check covers events. It does not cover a new state. A person must check each
  machine when a state is added.
- No test finds a new implicit machine. `AGENTS.md` states the rule for new code, and
  `DEVELOPMENT.md` adds an audit before each major release.
