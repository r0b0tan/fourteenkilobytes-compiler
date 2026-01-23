/**
 * Browser Entry Point
 *
 * Exports only browser-compatible APIs (no Node.js fs operations).
 * Used for client-side compilation.
 */

// Core compiler (browser-safe)
export { compile, dryRun, verifyDeterminism, formatResult, formatBreakdown } from './compiler.js';

// Types
export type {
  CompilerInput,
  CompilerResult,
  CompilerSuccess,
  CompilerFailure,
  CompilerError,
  CompiledPage,
  PageMeasurement,
  ModuleBreakdown,
  ContentBlock,
  InlineNode,
  TextNode,
  BoldNode,
  ItalicNode,
  LinkNode,
  NavigationModule,
  NavigationItem,
  FooterModule,
  CssModule,
  IconReference,
  DryRunResult,
  BuildManifest,
  ManifestEntry,
  PublishCheck,
  IndexState,
  IndexEntry,
} from './types.js';

export { SIZE_LIMIT, MAX_PAGINATION_ITERATIONS } from './types.js';

// Validation (browser-safe)
export { validateInput } from './validate.js';

// Measurement (browser-safe)
export { measureBytes, computeHash, normalizeLineEndings } from './measure.js';

// Icons (browser-safe)
export { getAvailableIconIds, isValidIconId, getIcon, getIconSvg, getIconBytes } from './icons.js';

// Manifest functions that don't use fs (browser-safe)
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
} from './manifest.js';
