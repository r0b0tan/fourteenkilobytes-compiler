/**
 * Main Compiler
 *
 * Orchestrates the compilation pipeline.
 * Responsible for: validation, flattening, measurement, pagination, emission.
 * Deterministic: identical input produces identical output.
 */

import type {
  CompilerInput,
  CompilerResult,
  CompilerSuccess,
  CompilerFailure,
  CompiledPage,
  PageMeasurement,
  DryRunResult,
  ModuleBreakdown,
} from './types.js';
import { SIZE_LIMIT } from './types.js';
import { validateInput } from './validate.js';
import { flatten, assemblePageWithContent } from './flatten.js';
import { paginate, paginatedSlug } from './paginate.js';
import {
  measureBytes,
  computeHash,
  createPageMeasurement,
  totalFromBreakdown,
} from './measure.js';

/**
 * Compile a page from input.
 *
 * Pipeline:
 * 1. Validate input
 * 2. Flatten abstractions to HTML
 * 3. Measure byte sizes
 * 4. Paginate if needed and allowed
 * 5. Emit compiled pages or fail
 */
export function compile(input: CompilerInput): CompilerResult {
  const timestamp = new Date().toISOString();

  // Stage 1: Validate
  const validation = validateInput(input);
  if (!validation.valid) {
    return {
      success: false,
      buildId: input.buildId,
      timestamp,
      error: validation.error,
    };
  }

  // Stage 2: Flatten
  const flattenResult = flatten(input);
  const { page, contentBlocks, breakdown } = flattenResult;

  // Stage 3: Measure total
  const totalBytes = totalFromBreakdown(breakdown);

  // Stage 4: Paginate if needed
  if (totalBytes > SIZE_LIMIT) {
    if (!input.allowPagination) {
      // Calculate available budget for content (SIZE_LIMIT minus fixed overhead)
      const fixedOverhead =
        breakdown.base +
        breakdown.title +
        breakdown.favicon +
        breakdown.meta +
        breakdown.css +
        breakdown.navigation +
        breakdown.footer +
        breakdown.icons +
        breakdown.pagination;
      const availableBudget = SIZE_LIMIT - fixedOverhead;

      // Check if any single block exceeds the available budget
      let oversizedBlock: { index: number; size: number; availableBudget: number } | undefined;
      for (const block of contentBlocks) {
        if (block.bytes > availableBudget) {
          oversizedBlock = {
            index: block.sourceIndex,
            size: block.bytes,
            availableBudget,
          };
          break;
        }
      }

      return {
        success: false,
        buildId: input.buildId,
        timestamp,
        error: {
          code: 'SIZE_LIMIT_EXCEEDED',
          measured: totalBytes,
          limit: SIZE_LIMIT,
          breakdown,
          oversizedBlock,
        },
        partialMeasurements: createPageMeasurement(input.slug, breakdown),
      };
    }
  }

  const paginationResult = paginate(
    input.slug,
    page,
    contentBlocks,
    breakdown,
    input.allowPagination
  );

  if (!paginationResult.success) {
    return {
      success: false,
      buildId: input.buildId,
      timestamp,
      error: paginationResult.error,
      partialMeasurements: createPageMeasurement(input.slug, breakdown),
    };
  }

  // Stage 5: Emit
  const compiledPages: CompiledPage[] = [];
  const measurements: PageMeasurement[] = [];
  const totalPages = paginationResult.pages.length;

  for (const paginatedPage of paginationResult.pages) {
    const slug = paginatedSlug(input.slug, paginatedPage.pageNumber);

    // Assemble final HTML
    const html = assemblePageWithContent(
      page,
      paginatedPage.contentHtml,
      paginatedPage.paginationHtml
    );

    const bytes = measureBytes(html);
    const hash = computeHash(html);

    // Final verification
    if (bytes > SIZE_LIMIT) {
      // Calculate available budget for content on this page
      const pageBreakdown = paginatedPage.breakdown;
      const pageFixedOverhead =
        pageBreakdown.base +
        pageBreakdown.title +
        pageBreakdown.favicon +
        pageBreakdown.meta +
        pageBreakdown.css +
        pageBreakdown.navigation +
        pageBreakdown.footer +
        pageBreakdown.icons +
        pageBreakdown.pagination;
      const pageAvailableBudget = SIZE_LIMIT - pageFixedOverhead;

      // Check if any single block on this page exceeds the budget
      let oversizedBlock: { index: number; size: number; availableBudget: number } | undefined;
      for (const block of paginatedPage.contentBlocks) {
        if (block.bytes > pageAvailableBudget) {
          oversizedBlock = {
            index: block.sourceIndex,
            size: block.bytes,
            availableBudget: pageAvailableBudget,
          };
          break;
        }
      }

      return {
        success: false,
        buildId: input.buildId,
        timestamp,
        error: {
          code: 'SIZE_LIMIT_EXCEEDED',
          measured: bytes,
          limit: SIZE_LIMIT,
          breakdown: paginatedPage.breakdown,
          oversizedBlock,
        },
      };
    }

    compiledPages.push({
      slug,
      pageNumber: paginatedPage.pageNumber,
      totalPages,
      html,
      bytes,
      hash,
    });

    measurements.push(createPageMeasurement(slug, paginatedPage.breakdown));
  }

  // Calculate totals
  const totals = {
    pageCount: compiledPages.length,
    totalBytes: compiledPages.reduce((sum, p) => sum + p.bytes, 0),
    largestPage: Math.max(...compiledPages.map((p) => p.bytes)),
    smallestPage: Math.min(...compiledPages.map((p) => p.bytes)),
  };

  return {
    success: true,
    buildId: input.buildId,
    timestamp,
    pages: compiledPages,
    measurements,
    totals,
  };
}

/**
 * Dry-run compilation.
 * Full pipeline without manifest updates or file writes.
 * Returns identical measurements to real compilation.
 */
export function dryRun(input: CompilerInput): DryRunResult {
  const result = compile(input);

  if (result.success) {
    return {
      wouldSucceed: true,
      measurements: result.measurements,
      pages: result.pages,
    };
  }

  return {
    wouldSucceed: false,
    error: result.error,
    partialMeasurements: result.partialMeasurements,
  };
}

/**
 * Verify compilation determinism.
 * Compiles input twice and compares hashes.
 */
export function verifyDeterminism(input: CompilerInput): boolean {
  const result1 = compile(input);
  const result2 = compile(input);

  if (!result1.success || !result2.success) {
    return result1.success === result2.success;
  }

  if (result1.pages.length !== result2.pages.length) {
    return false;
  }

  return result1.pages.every(
    (page, i) => page.hash === result2.pages[i].hash
  );
}

/**
 * Get breakdown summary as human-readable string.
 */
export function formatBreakdown(breakdown: ModuleBreakdown): string {
  const lines: string[] = [];
  const total = totalFromBreakdown(breakdown);

  const items: [string, number][] = [
    ['Base', breakdown.base],
    ['Title', breakdown.title],
    ['Meta', breakdown.meta],
    ['CSS', breakdown.css],
    ['Navigation', breakdown.navigation],
    ['Footer', breakdown.footer],
    ['Pagination', breakdown.pagination],
    ['Icons', breakdown.icons],
    ['Content', breakdown.content],
  ];

  for (const [name, bytes] of items) {
    if (bytes > 0) {
      const pct = ((bytes / total) * 100).toFixed(1);
      lines.push(`  ${name}: ${bytes} bytes (${pct}%)`);
    }
  }

  lines.push(`  Total: ${total} bytes`);
  lines.push(`  Remaining: ${SIZE_LIMIT - total} bytes`);
  lines.push(`  Utilization: ${((total / SIZE_LIMIT) * 100).toFixed(1)}%`);

  return lines.join('\n');
}

/**
 * Format compiler result for display.
 */
export function formatResult(result: CompilerResult): string {
  if (!result.success) {
    return `Compilation failed: ${result.error.code}\n${JSON.stringify(result.error, null, 2)}`;
  }

  const lines: string[] = [
    `Compilation successful`,
    `Build ID: ${result.buildId}`,
    `Timestamp: ${result.timestamp}`,
    `Pages: ${result.totals.pageCount}`,
    `Total bytes: ${result.totals.totalBytes}`,
    '',
  ];

  for (const measurement of result.measurements) {
    lines.push(`Page: ${measurement.slug}`);
    lines.push(formatBreakdown(measurement.breakdown));
    lines.push('');
  }

  return lines.join('\n');
}

// Re-export types for convenience
export type { CompilerInput, CompilerResult, CompilerSuccess, CompilerFailure };
