import path from 'node:path';
import { defineConfig } from 'vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

const config = defineConfig({
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact({
      babel: { plugins: ['babel-plugin-react-compiler'] },
    }),
  ],
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
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes('node_modules')) return;
              if (id.includes('@base-ui/')) return 'ui';
              if (id.includes('@tabler/')) return 'icons';
              if (id.includes('recharts') || id.includes('/d3-')) return 'charts';
              if (id.includes('i18next') || id.includes('react-i18next')) return 'i18n';
              if (id.includes('@tanstack/')) return 'tanstack';
              if (id.includes('/node_modules/react-dom/') || id.includes('/node_modules/react/')) {
                return 'react';
              }
              if (id.includes('/node_modules/scheduler/')) return 'react';
              return 'vendor';
            },
          },
        },
      },
    },
  },
});

export default config;
