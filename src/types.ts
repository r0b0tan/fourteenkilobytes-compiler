/**
 * 14KB Compiler Type Definitions
 *
 * All types used across the compilation pipeline.
 * No runtime values - pure type definitions.
 */

// =============================================================================
// CONSTANTS
// =============================================================================

export const SIZE_LIMIT = 14336; // 14 KB in bytes
export const MAX_PAGINATION_ITERATIONS = 10;

// =============================================================================
// INPUT MODEL
// =============================================================================

export interface CompilerInput {
  /** URL path segment, ASCII lowercase alphanumeric and hyphens only */
  slug: string;
  /** Page title */
  title: string;
  /** Content blocks */
  content: ContentBlock[];
  /** Navigation module, null if disabled */
  navigation: NavigationModule | null;
  /** Footer module, null if disabled */
  footer: FooterModule | null;
  /** CSS module, null if disabled */
  css: CssModule | null;
  /** Icon references from whitelist */
  icons: IconReference[];
  /** Allow compiler to split content across pages */
  allowPagination: boolean;
  /** Build identifier for determinism verification */
  buildId: string;
}

export interface ContentBlock {
  type: 'heading' | 'paragraph';
  /** For headings: level 1-6 */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Inline content */
  children: InlineNode[];
}

export type InlineNode = TextNode | LinebreakNode | BoldNode | ItalicNode | LinkNode;

export interface TextNode {
  type: 'text';
  text: string;
}

export interface LinebreakNode {
  type: 'linebreak';
}

export interface BoldNode {
  type: 'bold';
  children: InlineNode[];
}

export interface ItalicNode {
  type: 'italic';
  children: InlineNode[];
}

export interface LinkNode {
  type: 'link';
  href: string;
  children: InlineNode[];
}

export interface NavigationModule {
  items: NavigationItem[];
}

export interface NavigationItem {
  text: string;
  href: string;
}

export interface FooterModule {
  /** Plain text content */
  content: string;
}

export interface CssModule {
  /** Raw CSS rules, pre-validated for syntax */
  rules: string;
}

export interface IconReference {
  /** Must exist in compiler's icon whitelist */
  id: string;
  /** Placement context */
  placement: 'navigation' | 'content' | 'footer';
  /** Index within placement context */
  index: number;
}

// =============================================================================
// FLATTENED INTERMEDIATE REPRESENTATION
// =============================================================================

export interface FlattenedPage {
  doctype: string;
  htmlOpen: string;
  head: string;
  bodyOpen: string;
  navigation: string;
  content: string;
  footer: string;
  bodyClose: string;
  htmlClose: string;
}

export interface FlattenedContentBlock {
  html: string;
  bytes: number;
  sourceIndex: number;
}

// =============================================================================
// MEASUREMENT
// =============================================================================

export interface ModuleBreakdown {
  /** DOCTYPE, html, head structure, body tags */
  base: number;
  /** <title>...</title> */
  title: number;
  /** <style>...</style> including tags */
  css: number;
  /** <nav>...</nav> including tags */
  navigation: number;
  /** <footer>...</footer> including tags */
  footer: number;
  /** Pagination nav if present */
  pagination: number;
  /** All inline SVGs */
  icons: number;
  /** All content between nav and footer */
  content: number;
}

export interface SimpleMeasurements {
  total: number;
  /** HTML-Boilerplate + Navigation + Footer + CSS + Title + Icons + Pagination */
  overhead: number;
  /** Nur die Content-Blöcke */
  content: number;
}

export interface PageMeasurement {
  slug: string;
  breakdown: ModuleBreakdown;
  measurements: SimpleMeasurements;
  total: number;
  /** 14336 - total */
  remaining: number;
  /** total / 14336 */
  utilizationRatio: number;
}

// =============================================================================
// COMPILER OUTPUT
// =============================================================================

export interface CompiledPage {
  slug: string;
  /** 1-indexed, 1 if not paginated */
  pageNumber: number;
  totalPages: number;
  html: string;
  bytes: number;
  /** SHA-256 of html */
  hash: string;
}

export interface CompilerSuccess {
  success: true;
  buildId: string;
  /** ISO 8601 */
  timestamp: string;
  pages: CompiledPage[];
  measurements: PageMeasurement[];
  totals: {
    pageCount: number;
    totalBytes: number;
    largestPage: number;
    smallestPage: number;
  };
}

export interface CompilerFailure {
  success: false;
  buildId: string;
  /** ISO 8601 */
  timestamp: string;
  error: CompilerError;
  /** Available if measurement completed before failure */
  partialMeasurements?: PageMeasurement;
}

export type CompilerResult = CompilerSuccess | CompilerFailure;

// =============================================================================
// ERRORS
// =============================================================================

export type CompilerError =
  // Validation errors
  | { code: 'INVALID_SLUG'; slug: string; pattern: string }
  | { code: 'INVALID_HREF'; href: string; reason: string; path?: string }
  | { code: 'ICON_NOT_IN_WHITELIST'; iconId: string; available: string[]; path?: string }
  | { code: 'CSS_PARSE_ERROR'; offset: number; message: string }
  | { code: 'CONTENT_INVALID_ELEMENT'; element: string; allowed: string[]; path?: string }
  | { code: 'CONTENT_EMPTY'; message: string }
  | { code: 'EMPTY_TITLE'; message: string }
  | { code: 'TITLE_TOO_LONG'; length: number; maxLength: number }
  // Size errors
  | { code: 'SIZE_LIMIT_EXCEEDED'; measured: number; limit: number; breakdown: ModuleBreakdown; oversizedBlock?: { index: number; size: number; availableBudget: number } }
  // Pagination errors
  | { code: 'PAGINATION_DISABLED'; measured: number; limit: number }
  | { code: 'PAGINATION_BLOCK_TOO_LARGE'; blockIndex: number; blockSize: number; availableBudget: number }
  | { code: 'PAGINATION_NO_CONVERGENCE'; iterations: number }
  // Manifest errors
  | { code: 'SLUG_ALREADY_PUBLISHED'; slug: string; publishedAt: string }
  | { code: 'SLUG_IS_TOMBSTONE'; slug: string; tombstonedAt: string }
  | { code: 'MANIFEST_CORRUPTED'; reason: string };

// =============================================================================
// MANIFEST
// =============================================================================

export interface BuildManifest {
  version: 1;
  entries: ManifestEntry[];
}

export interface ManifestEntry {
  slug: string;
  status: 'published' | 'tombstone';
  /** ISO 8601, immutable after creation */
  publishedAt: string;
  /** SHA-256 of published HTML */
  hash: string;
  /** Page title for index */
  title: string;
  /** ISO 8601, only if status = tombstone */
  tombstonedAt?: string;
}

export interface PublishCheckAllowed {
  allowed: true;
}

export interface PublishCheckDenied {
  allowed: false;
  reason: 'SLUG_EXISTS' | 'SLUG_TOMBSTONED';
  existingHash?: string;
  publishedAt?: string;
  tombstonedAt?: string;
}

export type PublishCheck = PublishCheckAllowed | PublishCheckDenied;

// =============================================================================
// DRY RUN
// =============================================================================

export interface DryRunSuccess {
  wouldSucceed: true;
  measurements: PageMeasurement[];
  pages: CompiledPage[];
}

export interface DryRunFailure {
  wouldSucceed: false;
  error: CompilerError;
  partialMeasurements?: PageMeasurement;
}

export type DryRunResult = DryRunSuccess | DryRunFailure;

// =============================================================================
// INDEX
// =============================================================================

export interface IndexEntry {
  slug: string;
  title: string;
  publishedAt: string;
  status: 'published' | 'tombstone';
}

export interface IndexState {
  /** Ordered by publishedAt, oldest first */
  entries: IndexEntry[];
}
