#!/usr/bin/env node
/**
 * Build browser bundle of the compiler.
 * Output: dist/compiler.browser.js (ES module for browsers)
 */

import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/browser.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: 'dist/compiler.browser.js',
  minify: false, // Keep readable for debugging
  sourcemap: false,
  // Externalize Node.js built-ins (they won't be used)
  external: ['node:fs/promises', 'node:fs', 'node:path', 'node:crypto'],
  // Define empty shims for any accidental Node.js usage
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

console.log('Built: dist/compiler.browser.js');
