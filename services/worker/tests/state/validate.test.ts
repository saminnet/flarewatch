import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../src/state/incidents';
import { isMonitorState } from '../../src/state/validate';

describe('isMonitorState', () => {
  it('accepts createInitialState()', () => {
    expect(isMonitorState(createInitialState())).toBe(true);
  });

  it('rejects null', () => {
    expect(isMonitorState(null)).toBe(false);
  });

  it('rejects invalid incident shape', () => {
    const state = createInitialState() as unknown as Record<string, unknown>;
    state['incident'] = { test: 'nope' };

    expect(isMonitorState(state)).toBe(false);
  });

  it('rejects invalid latency shape', () => {
    const state = createInitialState() as unknown as Record<string, unknown>;
    state['latency'] = { test: { recent: [{ loc: 1, ping: 'x', time: 0 }] } };

    expect(isMonitorState(state)).toBe(false);
  });

  it('accepts sslCertificates when well-formed', () => {
    const state = createInitialState();
    state.sslCertificates = {
      test: {
        expiryDate: 1735689600,
        daysUntilExpiry: 30,
        lastCheck: 1700000000,
      },
    };

    expect(isMonitorState(state)).toBe(true);
  });
});
