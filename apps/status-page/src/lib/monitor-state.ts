import type { MonitorState } from '@flarewatch/shared';

export function createEmptyMonitorState(): MonitorState {
  return {
    incident: {},
    latency: {},
    overallUp: 0,
    overallDown: 0,
    lastUpdate: 0,
    startedAt: {},
  };
}

export async function resolveMonitorState(
  state: MonitorState | null,
  triggerCheck: () => Promise<boolean>,
): Promise<MonitorState | null> {
  if (!state) {
    console.warn('No state found in KV');
    const triggered = await triggerCheck();
    return triggered ? createEmptyMonitorState() : null;
  }

  if (state.lastUpdate === 0) {
    await triggerCheck();
  }

  return state;
}
