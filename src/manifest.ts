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
  ManifestEntry,
  PublishCheck,
  IndexState,
  IndexEntry,
  CompilerError,
} from './types.js';

/**
 * Create an empty manifest.
 */
export function createEmptyManifest(): BuildManifest {
  return {
    version: 1,
    entries: [],
  };
}

/**
 * Load manifest from file.
 * Returns empty manifest if file doesn't exist.
 */
export async function loadManifest(path: string): Promise<BuildManifest> {
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
 */
export async function saveManifest(
  path: string,
  manifest: BuildManifest
): Promise<void> {
  const content = JSON.stringify(manifest, null, 2);
  await writeFile(path, content, 'utf-8');
}

/**
 * Check if a slug can be published.
 */
export function canPublish(slug: string, manifest: BuildManifest): PublishCheck {
  const entry = manifest.entries.find((e) => e.slug === slug);

  if (!entry) {
    return { allowed: true };
  }

  if (entry.status === 'published') {
    return {
      allowed: false,
      reason: 'SLUG_EXISTS',
      existingHash: entry.hash,
      publishedAt: entry.publishedAt,
    };
  }

  if (entry.status === 'tombstone') {
    return {
      allowed: false,
      reason: 'SLUG_TOMBSTONED',
      tombstonedAt: entry.tombstonedAt,
    };
  }

  // Should not reach here
  return { allowed: true };
}

/**
 * Convert PublishCheck to CompilerError if denied.
 */
export function publishCheckToError(
  slug: string,
  check: PublishCheck
): CompilerError | null {
  if (check.allowed) {
    return null;
  }

  if (check.reason === 'SLUG_EXISTS') {
    return {
      code: 'SLUG_ALREADY_PUBLISHED',
      slug,
      publishedAt: check.publishedAt!,
    };
  }

  if (check.reason === 'SLUG_TOMBSTONED') {
    return {
      code: 'SLUG_IS_TOMBSTONE',
      slug,
      tombstonedAt: check.tombstonedAt!,
    };
  }

  return null;
}

/**
 * Add a new entry to the manifest.
 * Does not check if slug exists - caller must verify first.
 */
export function addEntry(
  manifest: BuildManifest,
  entry: ManifestEntry
): BuildManifest {
  return {
    ...manifest,
    entries: [...manifest.entries, entry],
  };
}

/**
 * Mark an entry as tombstoned.
 * Returns null if entry doesn't exist or is already tombstoned.
 */
export function tombstoneEntry(
  manifest: BuildManifest,
  slug: string,
  tombstonedAt: string
): BuildManifest | null {
  const entryIndex = manifest.entries.findIndex((e) => e.slug === slug);

  if (entryIndex === -1) {
    return null;
  }

  const entry = manifest.entries[entryIndex];
  if (entry.status === 'tombstone') {
    return null;
  }

  const updatedEntry: ManifestEntry = {
    ...entry,
    status: 'tombstone',
    tombstonedAt,
  };

  const entries = [...manifest.entries];
  entries[entryIndex] = updatedEntry;

  return {
    ...manifest,
    entries,
  };
}

/**
 * Get entry by slug.
 */
export function getEntry(
  manifest: BuildManifest,
  slug: string
): ManifestEntry | undefined {
  return manifest.entries.find((e) => e.slug === slug);
}

/**
 * Get all published entries.
 */
export function getPublishedEntries(manifest: BuildManifest): ManifestEntry[] {
  return manifest.entries.filter((e) => e.status === 'published');
}

/**
 * Get all tombstoned entries.
 */
export function getTombstonedEntries(manifest: BuildManifest): ManifestEntry[] {
  return manifest.entries.filter((e) => e.status === 'tombstone');
}

/**
 * Build index state from manifest.
 * Entries ordered by publishedAt, oldest first.
 */
export function buildIndexState(manifest: BuildManifest): IndexState {
  const entries: IndexEntry[] = manifest.entries.map((e) => ({
    slug: e.slug,
    title: e.title,
    publishedAt: e.publishedAt,
    status: e.status,
  }));

  // Sort by publishedAt ascending (oldest first)
  entries.sort(
    (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime()
  );

  return { entries };
}

/**
 * Generate tombstone HTML.
 * This is a static page with no dynamic content.
 */
export function generateTombstoneHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Page Removed</title>
</head>
<body>
<p>This page has been removed.</p>
</body>
</html>`;
}

/**
 * Validate manifest integrity.
 */
export function validateManifest(
  manifest: BuildManifest
): { valid: true } | { valid: false; error: CompilerError } {
  // Check version
  if (manifest.version !== 1) {
    return {
      valid: false,
      error: {
        code: 'MANIFEST_CORRUPTED',
        reason: `Invalid version: ${manifest.version}`,
      },
    };
  }

  // Check for duplicate slugs
  const slugs = new Set<string>();
  for (const entry of manifest.entries) {
    if (slugs.has(entry.slug)) {
      return {
        valid: false,
        error: {
          code: 'MANIFEST_CORRUPTED',
          reason: `Duplicate slug: ${entry.slug}`,
        },
      };
    }
    slugs.add(entry.slug);
  }

  // Check entry validity
  for (const entry of manifest.entries) {
    if (!entry.slug || !entry.hash || !entry.publishedAt || !entry.title) {
      return {
        valid: false,
        error: {
          code: 'MANIFEST_CORRUPTED',
          reason: `Invalid entry: ${entry.slug}`,
        },
      };
    }

    if (entry.status !== 'published' && entry.status !== 'tombstone') {
      return {
        valid: false,
        error: {
          code: 'MANIFEST_CORRUPTED',
          reason: `Invalid status for ${entry.slug}: ${entry.status}`,
        },
      };
    }

    if (entry.status === 'tombstone' && !entry.tombstonedAt) {
      return {
        valid: false,
        error: {
          code: 'MANIFEST_CORRUPTED',
          reason: `Tombstone without tombstonedAt: ${entry.slug}`,
        },
      };
    }
  }

  return { valid: true };
}
