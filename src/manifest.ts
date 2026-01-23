/**
 * Manifest Management
 *
 * Handles the append-only build manifest.
 * Enforces immutability of published pages.
 * Implements tombstone semantics for deletion.
 */

import { readFile, writeFile } from 'node:fs/promises';
import type {
  BuildManifest,
} from './types.js';

// Re-export all core functions (browser-safe)
export {
  createEmptyManifest,
  canPublish,
  publishCheckToError,
  addEntry,
  tombstoneEntry,
  getEntry,
  getPublishedEntries,
  getTombstonedEntries,
  buildIndexState,
  generateTombstoneHtml,
  validateManifest,
  type TombstoneResult,
} from './manifest.core.js';

/**
 * Load manifest from file.
 * Returns empty manifest if file doesn't exist.
 * 
 * NOTE: Node.js only - uses fs operations.
 */
export async function loadManifest(path: string): Promise<BuildManifest> {
  const { createEmptyManifest } = await import('./manifest.core.js');
  try {
    const content = await readFile(path, 'utf-8');
    const manifest = JSON.parse(content) as BuildManifest;

    // Validate version
    if (manifest.version !== 1) {
      throw new Error(`Unsupported manifest version: ${manifest.version}`);
    }

    return manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createEmptyManifest();
    }
    throw error;
  }
}

/**
 * Save manifest to file.
 * 
 * NOTE: Node.js only - uses fs operations.
 */
export async function saveManifest(
  path: string,
  manifest: BuildManifest
): Promise<void> {
  const content = JSON.stringify(manifest, null, 2);
  await writeFile(path, content, 'utf-8');
}
