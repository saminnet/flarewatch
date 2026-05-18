import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    ignorePatterns: [
      '.wrangler/**',
      'apps/status-page/dist/**',
      'services/worker/dist/**',
      'apps/status-page/src/routeTree.gen.ts',
      'apps/status-page/worker-configuration.d.ts',
    ],
    jsPlugins: [
      {
        name: 'react-hooks-js',
        specifier: 'eslint-plugin-react-hooks',
      },
    ],
    rules: {
      'react-hooks-js/set-state-in-render': 'error',
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ['.wrangler/**', '**/dist/**', 'worker-configuration.d.ts', 'routeTree.gen.ts'],
    printWidth: 100,
    tabWidth: 2,
    singleQuote: true,
    trailingComma: 'all',
  },
  staged: {
    '*.{js,cjs,mjs,jsx,ts,cts,mts,tsx,json,jsonc,md,yml,yaml}': 'vp check --fix',
  },
  run: {
    tasks: {
      build: {
        command: 'vp run status-page-build && vp run worker-build',
      },
      test: {
        command: 'vp run status-page-test && vp run worker-test && vp run shared-test',
      },
      dev: {
        command: 'vp run --filter status-page --filter worker dev',
        cache: false,
      },
      'status-page-build': {
        command: 'vp build',
        cwd: 'apps/status-page',
        input: [
          { auto: true },
          '!apps/status-page/.wrangler/**',
          '!apps/status-page/dist/**',
          '!apps/status-page/node_modules/.vite/**',
          '!apps/status-page/node_modules/.vite-temp/**',
        ],
      },
      'worker-build': {
        command: 'pnpm exec wrangler deploy src/index.ts --outdir dist --dry-run',
        cwd: 'services/worker',
        input: [{ auto: true }, '!services/worker/dist/**'],
      },
      'status-page-test': {
        command: 'vp test run',
        cwd: 'apps/status-page',
        input: [
          { auto: true },
          '!apps/status-page/node_modules/.vite/**',
          '!apps/status-page/node_modules/.vite-temp/**',
        ],
      },
      'worker-test': {
        command: 'vp test run',
        cwd: 'services/worker',
        input: [
          { auto: true },
          '!services/worker/node_modules/.vite/**',
          '!services/worker/node_modules/.vite-temp/**',
        ],
      },
      'shared-test': {
        command: 'vp test run',
        cwd: 'packages/shared',
        input: [
          { auto: true },
          '!packages/shared/node_modules/.vite/**',
          '!packages/shared/node_modules/.vite-temp/**',
        ],
      },
      ci: {
        command: 'vp check && vp run test && vp run build',
      },
      'dev-status-page': {
        command: 'vp run --filter status-page dev',
        cache: false,
      },
      'dev-worker': {
        command: 'vp run --filter worker dev',
        cache: false,
      },
      'infra:preview': {
        command: 'pulumi -C infra preview',
        cache: false,
      },
      'infra:up': {
        command: 'pulumi -C infra up',
        cache: false,
      },
      'infra:destroy': {
        command: 'pulumi -C infra destroy',
        cache: false,
      },
    },
  },
});
