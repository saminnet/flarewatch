import { describe, it, expect } from 'vite-plus/test';
import { createInitialState } from '../../src/state/incidents';
import { isMonitorState } from '@flarewatch/shared';

describe('isMonitorState', () => {
  it('accepts createInitialState()', () => {
    expect(isMonitorState(createInitialState())).toBe(true);
  });

  it('rejects null', () => {
    expect(isMonitorState(null)).toBe(false);
  });

  it('rejects invalid incident shape', () => {
    const state = { ...createInitialState(), incident: { test: 'nope' } };

    expect(isMonitorState(state)).toBe(false);
  });

  it('rejects invalid latency shape', () => {
    const state = {
      ...createInitialState(),
      latency: { test: { recent: [{ loc: 1, ping: 'x', time: 0 }] } },
    };

    expect(isMonitorState(state)).toBe(false);
  });

  it('accepts an open incident, whose end JSON omits', () => {
    const state = {
      ...createInitialState(),
      incident: { test: [{ start: [1700000000], error: ['timeout'] }] },
    };

    expect(isMonitorState(state)).toBe(true);
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
