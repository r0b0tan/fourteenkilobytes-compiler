/**
 * 14KB Compiler - Public API
 *
 * Exports all public interfaces for programmatic use.
 */

// Core compiler
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
  MetaModule,
  IconReference,
  DryRunResult,
  BuildManifest,
  ManifestEntry,
  PublishCheck,
  IndexState,
  IndexEntry,
} from './types.js';

export { SIZE_LIMIT, MAX_PAGINATION_ITERATIONS } from './types.js';

// Validation
export { validateInput } from './validate.js';

// Measurement
export { measureBytes, computeHash, normalizeLineEndings } from './measure.js';

// Icons
export { getAvailableIconIds, isValidIconId, getIcon, getIconSvg, getIconBytes } from './icons.js';

// Manifest
export {
  createEmptyManifest,
  loadManifest,
  saveManifest,
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
