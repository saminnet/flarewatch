import { expect, it } from 'vite-plus/test';
import type { HeartbeatSignal } from '@flarewatch/shared';
import { createHeartbeat } from '@flarewatch/shared/testing/monitors';
import { applyPing, evaluateHeartbeat, type PingKind } from '../../src/hub/heartbeat';

it('replays pending, up, running, late and down across pings and clock checks', () => {
  const monitor = createHeartbeat({ periodSeconds: 60, graceSeconds: 10 });
  const events: (
    | { kind: PingKind; at: number; message?: string }
    | { kind: 'clock'; at: number; status: string; ok?: boolean; deadline?: number }
  )[] = [
    { kind: 'clock', at: 0, status: 'pending' },
    { kind: 'success', at: 100 },
    { kind: 'clock', at: 160, status: 'up', ok: true, deadline: 170 },
    { kind: 'clock', at: 161, status: 'late', ok: true, deadline: 170 },
    { kind: 'clock', at: 170, status: 'late', ok: true, deadline: 170 },
    { kind: 'clock', at: 171, status: 'down', ok: false, deadline: 170 },
    { kind: 'start', at: 180 },
    { kind: 'clock', at: 190, status: 'running', deadline: 190 },
    { kind: 'clock', at: 191, status: 'down', ok: false, deadline: 190 },
    { kind: 'fail', at: 192, message: 'Backup failed' },
    { kind: 'clock', at: 192, status: 'down', ok: false, deadline: 170 },
    { kind: 'start', at: 193 },
    { kind: 'clock', at: 193, status: 'down', ok: false, deadline: 170 },
    { kind: 'success', at: 194 },
    { kind: 'clock', at: 194, status: 'up', ok: true, deadline: 264 },
  ];
  let signal: HeartbeatSignal = {};
  for (const event of events) {
    if (event.kind === 'clock') {
      const evaluation = evaluateHeartbeat(monitor, signal, event.at);
      expect(evaluation.heartbeat.status).toBe(event.status);
      expect(evaluation.heartbeat.deadline).toBe(event.deadline);
      expect(evaluation.result?.ok).toBe(event.ok);
    } else {
      const previous = structuredClone(signal);
      const next = applyPing(monitor, signal, event.kind, event.at, event.message);
      expect(signal).toEqual(previous);
      signal = next;
    }
  }
  expect(signal).toEqual({
    lastSuccess: 194,
    runs: [
      { at: 100, outcome: 'ok' },
      { at: 192, outcome: 'fail', startedAt: 180 },
      { at: 194, outcome: 'late', startedAt: 193 },
    ],
  });
});
