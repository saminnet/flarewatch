import * as esbuild from 'esbuild';

// Build Node.js adapter (for Docker/local)
await esbuild.build({
  entryPoints: ['src/adapters/node.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outfile: 'dist/node.mjs',
  external: [
    // Don't bundle Node.js built-ins
    'node:net',
    'node:tls',
  ],
  banner: {
    js: '// FlareWatch Proxy - Built with esbuild',
  },
});

console.log('Built dist/node.mjs');
