import { describe, expect, it, vi } from 'vitest';
import type { MonitorState } from '@flarewatch/shared';
import { createEmptyMonitorState, resolveMonitorState } from '../../src/lib/monitor-state';

function createState(overrides: Partial<MonitorState> = {}): MonitorState {
  return {
    incident: {},
    latency: {},
    overallUp: 0,
    overallDown: 0,
    lastUpdate: Math.floor(Date.now() / 1000),
    startedAt: {},
    ...overrides,
  };
}

describe('kv monitor state bootstrap', () => {
  it('returns initializing state when KV is empty and trigger dispatch succeeds', async () => {
    const triggerCheck = vi.fn().mockResolvedValue(true);

    await expect(resolveMonitorState(null, triggerCheck)).resolves.toEqual(
      createEmptyMonitorState(),
    );
    expect(triggerCheck).toHaveBeenCalledTimes(1);
  });

  it('returns null when KV is empty and trigger dispatch fails', async () => {
    const triggerCheck = vi.fn().mockResolvedValue(false);

    await expect(resolveMonitorState(null, triggerCheck)).resolves.toBeNull();
    expect(triggerCheck).toHaveBeenCalledTimes(1);
  });

  it('triggers when state exists but has never been updated', async () => {
    const triggerCheck = vi.fn().mockResolvedValue(true);
    const state = createState({ lastUpdate: 0 });

    await expect(resolveMonitorState(state, triggerCheck)).resolves.toBe(state);
    expect(triggerCheck).toHaveBeenCalledTimes(1);
  });

  it('does not trigger when state already has data', async () => {
    const triggerCheck = vi.fn().mockResolvedValue(true);
    const state = createState({ lastUpdate: 123 });

    await expect(resolveMonitorState(state, triggerCheck)).resolves.toBe(state);
    expect(triggerCheck).not.toHaveBeenCalled();
  });
});
