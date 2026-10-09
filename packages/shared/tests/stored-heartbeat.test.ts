import { describe, expect, it } from 'vite-plus/test';
import { parseHeartbeatSignal, parseHeartbeatState } from '../src/config';
import { isJsonObject } from '../src/utils';

const signal = {
  lastSuccess: 100,
  lastFail: 80,
  lastStart: 90,
  message: 'disk full',
  runs: [{ at: 100, outcome: 'ok', startedAt: 90 }],
};

describe('stored heartbeat parsing', () => {
  it('strips foreign signal and run fields without losing known fields', () => {
    expect(
      parseHeartbeatSignal({
        ...signal,
        status: 'down',
        deadline: 1,
        misses: [1],
        foreign: true,
        runs: [{ ...signal.runs[0], foreign: true }],
      }),
    ).toEqual(signal);
  });

  it('strips foreign state and run fields without losing known fields', () => {
    const state = { ...signal, status: 'running', deadline: 120, misses: [70] };
    expect(
      parseHeartbeatState({
        ...state,
        foreign: true,
        runs: [{ ...signal.runs[0], foreign: true }],
      }),
    ).toEqual(state);
  });

  it.each(
    [
      null,
      [],
      'signal',
      { lastSuccess: 'now' },
      { lastFail: null },
      { lastStart: false },
      { message: 1 },
      { runs: {} },
      { runs: [{ outcome: 'ok' }] },
      { runs: [{ at: 1, outcome: 'unknown' }] },
      { runs: [{ at: 1, outcome: 'ok', startedAt: 'now' }] },
      { lastSuccess: Infinity },
      { lastFail: NaN },
    ].map((value: unknown) => ({ value })),
  )('rejects malformed stored signal %j in both parsers', ({ value }) => {
    expect(parseHeartbeatSignal(value)).toBeNull();
    expect(parseHeartbeatState(value)).toBeNull();
    if (isJsonObject(value)) {
      expect(parseHeartbeatState({ ...value, status: 'up' })).toBeNull();
    }
  });

  it.each([
    { status: 'unknown' },
    { status: 'up', deadline: 'now' },
    { status: 'up', misses: [null] },
    { status: 'up', misses: 'none' },
    {},
  ])('rejects malformed stored state %j', (value) => {
    expect(parseHeartbeatState(value)).toBeNull();
  });
});
