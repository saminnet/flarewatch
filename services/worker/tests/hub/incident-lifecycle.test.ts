import { expect, it } from 'vite-plus/test';
import {
  IncidentState,
  stepIncident,
  type IncidentLifecycle,
} from '../../src/hub/incident-lifecycle';
import baseline from '../fixtures/hub-lifecycle-logs.json';

it('replays captured incident boundaries, relapse and certificate recovery', () => {
  const names = [
    'first incident and close',
    'error cap',
    'reopen boundary',
    'new incident beyond boundary',
    'reopen resets acknowledgement',
    'relapse keeps acknowledgement',
    'hold boundary',
    'legacy Certificate recovery',
    'legacy SSL certificate recovery',
  ];
  for (const name of names) {
    let state: IncidentLifecycle = { state: IncidentState.Absent };
    for (const entry of baseline.find((log) => log.name === name)!.log) {
      if (!entry.now || !entry.updates?.length) continue;
      const event = entry.token.startsWith('U')
        ? {
            type: 'passed' as const,
            now: entry.now,
            legacyCertificate: name.includes('certificate') || name.includes('Certificate'),
          }
        : {
            type: 'failed' as const,
            now: entry.now,
            changed: entry.updates[0]?.changeType === 'error',
          };
      const transition = stepIncident(state, event);
      state = transition.next;
      if (entry.updates[0]?.changeType === 'error') expect(transition.effect).toBe('segment');
      const history = entry.history?.[0];
      if (transition.effect === 'close' && state.state === IncidentState.Closed)
        expect(state.end).toBe(history && 'end' in history ? history.end : undefined);
      if (state.state === IncidentState.RecoveryHold)
        expect(entry.updates[0]?.changeType).toBe('none');
    }
  }
});

it.each([
  [1960, 'reopen', IncidentState.ReopenedDown],
  [1961, 'insert', IncidentState.Open],
] as const)('fails at %i after closing at 1060', (now, effect, state) => {
  expect(
    stepIncident(
      { state: IncidentState.Closed, end: 1060 },
      {
        type: 'failed',
        now,
        changed: false,
      },
    ),
  ).toMatchObject({ effect, next: { state } });
});
