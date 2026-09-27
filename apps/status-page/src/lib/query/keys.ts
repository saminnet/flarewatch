export const qk = {
  config: ['config'] as const,
  session: ['session'] as const,
  snapshot: ['snapshot'] as const,
  visitorSnapshot: ['snapshot', 'visitor'] as const,
  operatorSnapshot: ['snapshot', 'operator'] as const,
  latency: (monitorId: string) => ['latency', monitorId] as const,
  allLatency: ['latency'] as const,
  uiPrefs: ['uiPrefs'] as const,
};
