import path from 'node:path';
import { defineConfig } from 'vite-plus';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import babel from '@rolldown/plugin-babel';
import transformImports from '@rolldown/plugin-transform-imports';
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// SAFETY: these plugins share the same runtime shape, but Vite's and Rolldown's published
// plugin element types are declared independently and TS 6's deep comparison across both
// package graphs fails; `never` defers element checking to defineConfig's own plugin type.
const plugins = [
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
] as never;

const config = defineConfig({
  plugins,
  optimizeDeps: {
    include: ['react', 'react-dom', '@tanstack/react-query'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
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
