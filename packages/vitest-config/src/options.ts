export const commonTestOptions = {
  globals: true,
  environment: 'node',
  setupFiles: ['@flarewatch/vitest-config/setup'],
  restoreMocks: true,
  mockReset: true,
  unstubEnvs: true,
  unstubGlobals: true,
};
