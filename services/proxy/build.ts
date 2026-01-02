import * as esbuild from 'esbuild';

await esbuild.build({
  banner: {
    js: '// FlareWatch Proxy - Built with esbuild',
  },
  bundle: true,
  entryPoints: ['src/index.ts'],
  external: ['node:net', 'node:tls'],
  format: 'esm',
  outfile: 'dist/index.mjs',
  platform: 'node',
  target: 'node24',
});

console.log('Built dist/index.mjs');
