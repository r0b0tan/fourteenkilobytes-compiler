#!/usr/bin/env node

/**
 * CLI Interface
 *
 * Command-line interface for the 14KB compiler.
 * Strictly separates compilation from file I/O.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import type { CompilerInput, ManifestEntry } from './types.js';
import { compile, dryRun, formatResult } from './compiler.js';
import {
  loadManifest,
  saveManifest,
  canPublish,
  publishCheckToError,
  addEntry,
  tombstoneEntry,
  generateTombstoneHtml,
  buildIndexState,
} from './manifest.js';
import { getAvailableIconIds } from './icons.js';

const MANIFEST_FILE = 'manifest.json';
const OUTPUT_DIR = 'dist';

/**
 * CLI commands.
 */
type Command = 'compile' | 'dry-run' | 'tombstone' | 'index' | 'icons' | 'help';

/**
 * Parse command line arguments.
 */
function parseCliArgs(): { command: Command; args: string[]; options: Record<string, unknown> } {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      input: { type: 'string', short: 'i' },
      output: { type: 'string', short: 'o' },
      manifest: { type: 'string', short: 'm' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const command = (positionals[0] as Command) || 'help';
  const args = positionals.slice(1);

  return { command, args, options: values };
}

/**
 * Print help message.
 */
function printHelp(): void {
  console.log(`
14KB Compiler - Constraint-driven static page compiler

USAGE:
  14kb <command> [options]

COMMANDS:
  compile <input.json>    Compile a page from JSON input
  dry-run <input.json>    Preview compilation without writing files
  tombstone <slug>        Mark a page as deleted (tombstone)
  index                   Generate index page from manifest
  icons                   List available icons
  help                    Show this help message

OPTIONS:
  -i, --input <file>      Input JSON file
  -o, --output <dir>      Output directory (default: dist)
  -m, --manifest <file>   Manifest file (default: manifest.json)
  -h, --help              Show help

EXAMPLES:
  14kb compile post.json
  14kb dry-run post.json
  14kb tombstone my-old-post
  14kb index
  14kb icons
`);
}

/**
 * Load input from JSON file.
 */
async function loadInput(path: string): Promise<CompilerInput> {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as CompilerInput;
}

/**
 * Ensure output directory exists.
 */
async function ensureOutputDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/**
 * Compile command.
 */
async function runCompile(
  inputPath: string,
  outputDir: string,
  manifestPath: string
): Promise<number> {
  // Load input
  let input: CompilerInput;
  try {
    input = await loadInput(inputPath);
  } catch (error) {
    console.error(`Failed to load input: ${inputPath}`);
    console.error(error);
    return 1;
  }

  // Load manifest
  const manifest = await loadManifest(manifestPath);

  // Check if slug can be published
  const check = canPublish(input.slug, manifest);
  if (!check.allowed) {
    const error = publishCheckToError(input.slug, check);
    console.error(`Cannot publish: ${error?.code}`);
    console.error(JSON.stringify(error, null, 2));
    return 1;
  }

  // Compile
  const result = compile(input);

  if (!result.success) {
    console.error('Compilation failed');
    console.error(formatResult(result));
    return 1;
  }

  // Write output files
  await ensureOutputDir(outputDir);

  for (const page of result.pages) {
    const outputPath = join(outputDir, `${page.slug}.html`);
    await writeFile(outputPath, page.html, 'utf-8');
    console.log(`Wrote: ${outputPath} (${page.bytes} bytes)`);
  }

  // Update manifest
  const timestamp = new Date().toISOString();
  let updatedManifest = manifest;

  for (const page of result.pages) {
    const entry: ManifestEntry = {
      slug: page.slug,
      status: 'published',
      publishedAt: timestamp,
      hash: page.hash,
      title: input.title,
    };
    updatedManifest = addEntry(updatedManifest, entry);
  }

  await saveManifest(manifestPath, updatedManifest);
  console.log(`Updated manifest: ${manifestPath}`);

  // Print summary
  console.log('');
  console.log(formatResult(result));

  return 0;
}

/**
 * Dry-run command.
 */
async function runDryRun(inputPath: string): Promise<number> {
  // Load input
  let input: CompilerInput;
  try {
    input = await loadInput(inputPath);
  } catch (error) {
    console.error(`Failed to load input: ${inputPath}`);
    console.error(error);
    return 1;
  }

  // Dry run
  const result = dryRun(input);

  if (!result.wouldSucceed) {
    console.error('Compilation would fail');
    console.error(JSON.stringify(result.error, null, 2));
    if (result.partialMeasurements) {
      console.error('Partial measurements:');
      console.error(JSON.stringify(result.partialMeasurements, null, 2));
    }
    return 1;
  }

  console.log('Compilation would succeed');
  console.log('');

  for (const measurement of result.measurements) {
    console.log(`Page: ${measurement.slug}`);
    console.log(`  Total: ${measurement.total} bytes`);
    console.log(`  Remaining: ${measurement.remaining} bytes`);
    console.log(`  Utilization: ${(measurement.utilizationRatio * 100).toFixed(1)}%`);
    console.log('  Breakdown:');
    for (const [key, value] of Object.entries(measurement.breakdown)) {
      if (value > 0) {
        console.log(`    ${key}: ${value} bytes`);
      }
    }
    console.log('');
  }

  return 0;
}

/**
 * Tombstone command.
 */
async function runTombstone(
  slug: string,
  outputDir: string,
  manifestPath: string
): Promise<number> {
  // Load manifest
  const manifest = await loadManifest(manifestPath);

  // Tombstone entry
  const timestamp = new Date().toISOString();
  const updatedManifest = tombstoneEntry(manifest, slug, timestamp);

  if (!updatedManifest) {
    console.error(`Cannot tombstone: ${slug}`);
    console.error('Entry does not exist or is already tombstoned');
    return 1;
  }

  // Write tombstone HTML
  await ensureOutputDir(outputDir);
  const outputPath = join(outputDir, `${slug}.html`);
  const tombstoneHtml = generateTombstoneHtml();
  await writeFile(outputPath, tombstoneHtml, 'utf-8');
  console.log(`Wrote tombstone: ${outputPath}`);

  // Update manifest
  await saveManifest(manifestPath, updatedManifest);
  console.log(`Updated manifest: ${manifestPath}`);

  return 0;
}

/**
 * Index command.
 */
async function runIndex(
  outputDir: string,
  manifestPath: string
): Promise<number> {
  // Load manifest
  const manifest = await loadManifest(manifestPath);

  // Build index state
  const indexState = buildIndexState(manifest);

  // Generate index HTML
  const entries = indexState.entries
    .map((entry) => {
      if (entry.status === 'tombstone') {
        return `<li><del>${escapeHtml(entry.title)}</del> <span>(removed)</span></li>`;
      }
      return `<li><a href="${entry.slug}.html">${escapeHtml(entry.title)}</a></li>`;
    })
    .join('\n');

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Index</title>
</head>
<body>
<h1>Index</h1>
<ul>
${entries}
</ul>
</body>
</html>`;

  // Write index
  await ensureOutputDir(outputDir);
  const outputPath = join(outputDir, 'index.html');
  await writeFile(outputPath, indexHtml, 'utf-8');
  console.log(`Wrote index: ${outputPath}`);

  return 0;
}

/**
 * Icons command.
 */
function runIcons(): number {
  const icons = getAvailableIconIds();
  console.log('Available icons:');
  for (const id of icons) {
    console.log(`  ${id}`);
  }
  return 0;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Main entry point.
 */
async function main(): Promise<number> {
  const { command, args, options } = parseCliArgs();

  if (options.help || command === 'help') {
    printHelp();
    return 0;
  }

  const outputDir = (options.output as string) || OUTPUT_DIR;
  const manifestPath = (options.manifest as string) || MANIFEST_FILE;

  switch (command) {
    case 'compile': {
      const inputPath = args[0] || (options.input as string);
      if (!inputPath) {
        console.error('Missing input file');
        printHelp();
        return 1;
      }
      return runCompile(inputPath, outputDir, manifestPath);
    }

    case 'dry-run': {
      const inputPath = args[0] || (options.input as string);
      if (!inputPath) {
        console.error('Missing input file');
        printHelp();
        return 1;
      }
      return runDryRun(inputPath);
    }

    case 'tombstone': {
      const slug = args[0];
      if (!slug) {
        console.error('Missing slug');
        printHelp();
        return 1;
      }
      return runTombstone(slug, outputDir, manifestPath);
    }

    case 'index':
      return runIndex(outputDir, manifestPath);

    case 'icons':
      return runIcons();

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      return 1;
  }
}

// Run
main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
