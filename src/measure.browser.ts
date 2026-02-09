/**
 * UTF-8 Byte Measurement (Browser Version)
 *
 * All measurements are exact. No estimation.
 * Uses TextEncoder for accurate UTF-8 byte counting.
 * Uses Web Crypto API for hashing (browser-compatible).
 */

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
 * Compute SHA-256 hash of a string using Web Crypto API.
 * Used for determinism verification.
 */
export async function computeHash(str: string): Promise<string> {
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
  const overhead =
    breakdown.base +
    breakdown.title +
    breakdown.favicon +
    breakdown.meta +
    breakdown.css +
    breakdown.navigation +
    breakdown.footer +
    breakdown.pagination +
    breakdown.icons;

  const content = breakdown.content;
  const total = overhead + content;

  return {
    slug,
    breakdown,
    measurements: {
      total,
      overhead,
      content,
    },
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
    favicon: 0,
    meta: 0,
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
    result.meta += b.meta;
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
    breakdown.favicon +
    breakdown.meta +
    breakdown.css +
    breakdown.navigation +
    breakdown.footer +
    breakdown.pagination +
    breakdown.icons +
    breakdown.content
  );
}

export function sanitizeHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const allowedTags = ['a', 'b', 'strong', 'i', 'em', 'u', 'br', 'p', 'span', 'small', 'code', 'ul', 'ol', 'li'];
  
  function sanitizeNode(node: Node): Node | DocumentFragment {
    if (node.nodeType === 3) return document.createTextNode(node.textContent || '');
    if (node.nodeType !== 1) return document.createTextNode('');

    const element = node as Element;
    const tagName = element.tagName.toLowerCase();
    
    if (['script', 'style', 'img', 'iframe', 'object', 'embed', 'form'].includes(tagName)) {
      return document.createTextNode('');
    }

    if (allowedTags.includes(tagName)) {
      const newNode = document.createElement(tagName);
      for (const attr of Array.from(element.attributes)) {
        const name = attr.name.toLowerCase();
        if (['href', 'target', 'rel', 'title', 'class'].includes(name) || name.startsWith('aria-')) {
          if (name === 'href' && (attr.value.trim().toLowerCase().startsWith('javascript:') || attr.value.trim().toLowerCase().startsWith('data:'))) {
            continue;
          }
          newNode.setAttribute(name, attr.value);
        }
      }
      
      let child = node.firstChild;
      while (child) {
        const sanitizedChild = sanitizeNode(child);
        if (sanitizedChild) {
             newNode.appendChild(sanitizedChild);
        }
        child = child.nextSibling;
      }
      return newNode;
    } else {
      const fragment = document.createDocumentFragment();
      let child = node.firstChild;
      while (child) {
        const sanitizedChild = sanitizeNode(child);
        if (sanitizedChild) {
            fragment.appendChild(sanitizedChild);
        }
        child = child.nextSibling;
      }
      return fragment;
    }
  }

  const result = document.createElement('div');
  let child = doc.body.firstChild;
  while (child) {
     const sanitizedChild = sanitizeNode(child);
     if (sanitizedChild) {
        result.appendChild(sanitizedChild);
     }
    child = child.nextSibling;
  }
  return result.innerHTML;
}
