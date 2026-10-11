/** The test options each package shares: one setup file, and mocks, envs and globals undone after each test. */
export const commonTestOptions = {
  globals: true,
  environment: 'node',
  setupFiles: [`${import.meta.dirname}/vitest.setup.ts`],
  restoreMocks: true,
  mockReset: true,
  unstubEnvs: true,
  unstubGlobals: true,
};
