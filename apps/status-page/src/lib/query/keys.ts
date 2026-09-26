export const qk = {
  config: ['config'] as const,
  session: ['session'] as const,
  snapshot: ['snapshot'] as const,
  visitorSnapshot: ['snapshot', 'visitor'] as const,
  operatorSnapshot: ['snapshot', 'operator'] as const,
  uiPrefs: ['uiPrefs'] as const,
};
