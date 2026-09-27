import path from 'node:path';
import { defineConfig } from 'vite-plus';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import babel from '@rolldown/plugin-babel';
import transformImports from '@rolldown/plugin-transform-imports';
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// Browser-test builds swap in test monitors; FLAREWATCH_E2E=private also makes the page private.
const e2e = process.env.FLAREWATCH_E2E;
const e2eConfig = path.resolve(import.meta.dirname, 'tests/e2e/config');

const config = defineConfig({
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    transformImports({
      '@tabler/icons-react': {
        transform: '@tabler/icons-react/dist/esm/icons/{{member}}.mjs',
      },
    }),
    tanstackStart(),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  optimizeDeps: {
    include: ['react', 'react-dom', '@tanstack/react-query'],
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
      ...(e2e
        ? [{ find: /^@flarewatch\/config\/worker$/, replacement: `${e2eConfig}/worker.ts` }]
        : []),
      ...(e2e === 'private'
        ? [{ find: /^@flarewatch\/config$/, replacement: `${e2eConfig}/private.ts` }]
        : []),
    ],
    dedupe: ['react', 'react-dom'],
  },
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            codeSplitting: {
              groups: [
                {
                  name: 'react',
                  test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
                },
              ],
            },
          },
        },
      },
    },
  },
});

export default config;
