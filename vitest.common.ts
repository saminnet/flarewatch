export const commonTestOptions = {
  globals: true,
  environment: 'node',
  setupFiles: ['../../vitest.setup.ts'],
  restoreMocks: true,
  mockReset: true,
  unstubEnvs: true,
  unstubGlobals: true,
};
