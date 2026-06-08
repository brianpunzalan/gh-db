import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'node18',
    outDir: 'dist',
    splitting: false,
    treeshake: true,
  },
  {
    entry: { 'index.browser': 'src/index.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2020',
    outDir: 'dist',
    dts: false,
    clean: false,
    sourcemap: true,
    splitting: false,
    treeshake: true,
  },
]);
