/**
 * UTF-8 Byte Measurement
 *
 * All measurements are exact. No estimation.
 * Uses TextEncoder for accurate UTF-8 byte counting.
 */

import { createHash } from 'node:crypto';
import type { ModuleBreakdown, PageMeasurement } from './types.js';
import { SIZE_LIMIT } from './types.js';

const encoder = new TextEncoder();

/**
 * Measure exact UTF-8 byte length of a string.
 *
 * - Multi-byte characters counted correctly
 * - HTML entities measured in encoded form
 * - No estimation or approximation
 */
export function measureBytes(str: string): number {
  return encoder.encode(str).length;
}

/**
 * Compute SHA-256 hash of a string.
 * Used for determinism verification.
 */
export function computeHash(str: string): string {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Normalize line endings to LF before measurement.
 * Output uses \n exclusively.
 */
export function normalizeLineEndings(str: string): string {
  return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Create a PageMeasurement from a breakdown.
 */
export function createPageMeasurement(
  slug: string,
  breakdown: ModuleBreakdown
): PageMeasurement {
  const total =
    breakdown.base +
    breakdown.title +
    breakdown.css +
    breakdown.navigation +
    breakdown.footer +
    breakdown.pagination +
    breakdown.icons +
    breakdown.content;

  return {
    slug,
    breakdown,
    total,
    remaining: SIZE_LIMIT - total,
    utilizationRatio: total / SIZE_LIMIT,
  };
}

/**
 * Create an empty breakdown with all zeros.
 */
export function emptyBreakdown(): ModuleBreakdown {
  return {
    base: 0,
    title: 0,
    css: 0,
    navigation: 0,
    footer: 0,
    pagination: 0,
    icons: 0,
    content: 0,
  };
}

/**
 * Sum multiple breakdowns into one.
 */
export function sumBreakdowns(breakdowns: ModuleBreakdown[]): ModuleBreakdown {
  const result = emptyBreakdown();
  for (const b of breakdowns) {
    result.base += b.base;
    result.title += b.title;
    result.css += b.css;
    result.navigation += b.navigation;
    result.footer += b.footer;
    result.pagination += b.pagination;
    result.icons += b.icons;
    result.content += b.content;
  }
  return result;
}

/**
 * Calculate total from breakdown.
 */
export function totalFromBreakdown(breakdown: ModuleBreakdown): number {
  return (
    breakdown.base +
    breakdown.title +
    breakdown.css +
    breakdown.navigation +
    breakdown.footer +
    breakdown.pagination +
    breakdown.icons +
    breakdown.content
  );
}
