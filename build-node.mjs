#!/usr/bin/env node
/**
 * Build single-file Node.js bundle of the compiler.
 * Output: dist/compiler.js (ES module for Node.js)
 */

import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/compiler.js',
  minify: false,
  sourcemap: false,
});

console.log('Built: dist/compiler.js');
