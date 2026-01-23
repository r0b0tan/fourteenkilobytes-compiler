#!/usr/bin/env node
/**
 * Build browser bundle of the compiler.
 * Output: dist/compiler.browser.js (ES module for browsers)
 */

import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: ['src/browser.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: 'dist/compiler.browser.js',
  minify: false, // Keep readable for debugging
  sourcemap: false,
  // Define empty shims for any accidental Node.js usage
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  platform: 'browser',
  plugins: [
    {
      name: 'browser-shims',
      setup(build) {
        // Redirect measure.ts to measure.browser.ts
        build.onResolve({ filter: /measure\.js$/ }, args => {
          if (args.path === './measure.js') {
            return {
              path: path.resolve(__dirname, 'src', 'measure.browser.ts'),
            };
          }
        });
      }
    }
  ],
});

console.log('Built: dist/compiler.browser.js');
