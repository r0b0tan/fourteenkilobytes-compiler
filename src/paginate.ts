/**
 * Pagination Logic
 *
 * Iterative algorithm to split content across pages.
 * Each page must independently satisfy the 14KB limit.
 * Pagination overhead is measured exactly.
 */

import type {
  FlattenedPage,
  FlattenedContentBlock,
  ModuleBreakdown,
  CompilerError,
} from './types.js';
import { SIZE_LIMIT, MAX_PAGINATION_ITERATIONS } from './types.js';
import { measureBytes, totalFromBreakdown } from './measure.js';

/**
 * A page in the pagination result.
 */
export interface PaginatedPage {
  pageNumber: number;
  contentBlocks: FlattenedContentBlock[];
  contentHtml: string;
  paginationHtml: string;
  breakdown: ModuleBreakdown;
}

/**
 * Result of pagination.
 */
export type PaginationResult =
  | { success: true; pages: PaginatedPage[] }
  | { success: false; error: CompilerError };

/**
 * Generate pagination navigation HTML.
 */
function generatePaginationNav(
  baseSlug: string,
  currentPage: number,
  totalPages: number
): string {
  if (totalPages <= 1) {
    return '';
  }

  const links: string[] = [];

  for (let i = 1; i <= totalPages; i++) {
    const slug = i === 1 ? `${baseSlug}.html` : `${baseSlug}-${i}.html`;

    if (i === currentPage) {
      links.push(`<span>${i}</span>`);
    } else {
      links.push(`<a href="${slug}">${i}</a>`);
    }
  }

  return `<nav aria-label="pagination">\n${links.join('\n')}\n</nav>`;
}

/**
 * Calculate pagination navigation bytes for a given page count.
 */
function calculatePaginationBytes(
  baseSlug: string,
  currentPage: number,
  totalPages: number
): number {
  const html = generatePaginationNav(baseSlug, currentPage, totalPages);
  return measureBytes(html);
}

/**
 * Calculate fixed overhead (structure without content or pagination).
 */
function calculateFixedOverhead(breakdown: ModuleBreakdown): number {
  return (
    breakdown.base +
    breakdown.title +
    breakdown.favicon +
    breakdown.meta +
    breakdown.css +
    breakdown.navigation +
    breakdown.footer +
    breakdown.icons
  );
}

/**
 * Paginate content blocks to fit within size limit.
 *
 * Algorithm:
 * 1. Calculate fixed overhead
 * 2. Estimate page count
 * 3. Distribute blocks across pages
 * 4. Re-measure with actual pagination overhead
 * 5. Iterate until stable
 */
export function paginate(
  baseSlug: string,
  page: FlattenedPage,
  contentBlocks: FlattenedContentBlock[],
  baseBreakdown: ModuleBreakdown,
  allowPagination: boolean
): PaginationResult {
  const fixedOverhead = calculateFixedOverhead(baseBreakdown);

  // Calculate total content size
  const totalContentBytes = contentBlocks.reduce((sum, b) => sum + b.bytes, 0);
  // Account for newlines between blocks
  const contentNewlines = Math.max(0, contentBlocks.length - 1);
  const totalContentWithNewlines = totalContentBytes + contentNewlines;

  // Check if pagination is needed
  if (fixedOverhead + totalContentWithNewlines <= SIZE_LIMIT) {
    // No pagination needed
    const contentHtml = contentBlocks.map((b) => b.html).join('\n');
    return {
      success: true,
      pages: [
        {
          pageNumber: 1,
          contentBlocks,
          contentHtml,
          paginationHtml: '',
          breakdown: {
            ...baseBreakdown,
            content: measureBytes(contentHtml),
            pagination: 0,
          },
        },
      ],
    };
  }

  // Pagination required
  if (!allowPagination) {
    return {
      success: false,
      error: {
        code: 'PAGINATION_DISABLED',
        measured: fixedOverhead + totalContentWithNewlines,
        limit: SIZE_LIMIT,
      },
    };
  }

  // Iterative pagination
  let estimatedPages = Math.ceil(
    totalContentWithNewlines / (SIZE_LIMIT - fixedOverhead - 100)
  );
  estimatedPages = Math.max(2, estimatedPages);

  let iteration = 0;
  let pages: PaginatedPage[] = [];
  let previousPageCount = 0;

  while (iteration < MAX_PAGINATION_ITERATIONS) {
    iteration++;

    pages = [];
    let currentPageBlocks: FlattenedContentBlock[] = [];
    let currentPageBytes = 0;
    let pageNumber = 1;

    for (let i = 0; i < contentBlocks.length; i++) {
      const block = contentBlocks[i];

      // Calculate pagination overhead for this page
      const paginationBytes = calculatePaginationBytes(
        baseSlug,
        pageNumber,
        estimatedPages
      );

      // Available budget for content
      const availableBudget = SIZE_LIMIT - fixedOverhead - paginationBytes;

      // Calculate size with this block added
      const newlineBytes = currentPageBlocks.length > 0 ? 1 : 0;
      const candidateBytes = currentPageBytes + newlineBytes + block.bytes;

      if (candidateBytes <= availableBudget) {
        // Block fits
        currentPageBlocks.push(block);
        currentPageBytes = candidateBytes;
      } else {
        // Block doesn't fit

        if (currentPageBlocks.length === 0) {
          // Single block exceeds budget
          return {
            success: false,
            error: {
              code: 'PAGINATION_BLOCK_TOO_LARGE',
              blockIndex: block.sourceIndex,
              blockSize: block.bytes,
              availableBudget,
            },
          };
        }

        // Emit current page
        const contentHtml = currentPageBlocks.map((b) => b.html).join('\n');
        const paginationHtml = generatePaginationNav(
          baseSlug,
          pageNumber,
          estimatedPages
        );

        pages.push({
          pageNumber,
          contentBlocks: currentPageBlocks,
          contentHtml,
          paginationHtml,
          breakdown: {
            ...baseBreakdown,
            content: measureBytes(contentHtml),
            pagination: measureBytes(paginationHtml),
          },
        });

        // Start new page with current block
        pageNumber++;
        currentPageBlocks = [block];
        currentPageBytes = block.bytes;
      }
    }

    // Emit final page
    if (currentPageBlocks.length > 0) {
      const contentHtml = currentPageBlocks.map((b) => b.html).join('\n');
      const paginationHtml = generatePaginationNav(
        baseSlug,
        pageNumber,
        estimatedPages
      );

      pages.push({
        pageNumber,
        contentBlocks: currentPageBlocks,
        contentHtml,
        paginationHtml,
        breakdown: {
          ...baseBreakdown,
          content: measureBytes(contentHtml),
          pagination: measureBytes(paginationHtml),
        },
      });
    }

    // Check convergence
    if (pages.length === previousPageCount) {
      // Converged - verify all pages fit
      const oversized = pages.find((p) => totalFromBreakdown(p.breakdown) > SIZE_LIMIT);
      if (oversized) {
        // Should not happen, but handle gracefully
        return {
          success: false,
          error: {
            code: 'PAGINATION_NO_CONVERGENCE',
            iterations: iteration,
          },
        };
      }

      // Update pagination HTML with actual page count
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        p.paginationHtml = generatePaginationNav(baseSlug, p.pageNumber, pages.length);
        p.breakdown.pagination = measureBytes(p.paginationHtml);
      }

      return { success: true, pages };
    }

    // Update estimate and try again
    previousPageCount = pages.length;
    estimatedPages = pages.length;
  }

  // Did not converge
  return {
    success: false,
    error: {
      code: 'PAGINATION_NO_CONVERGENCE',
      iterations: MAX_PAGINATION_ITERATIONS,
    },
  };
}

/**
 * Generate slug for a paginated page.
 */
export function paginatedSlug(baseSlug: string, pageNumber: number): string {
  return pageNumber === 1 ? baseSlug : `${baseSlug}-${pageNumber}`;
}
