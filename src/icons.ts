/**
 * Icon Whitelist
 *
 * Fixed set of allowed inline SVG icons.
 * Icons are compile-time resources.
 * Each icon has a pre-measured byte cost.
 */

import { measureBytes } from './measure.js';

/**
 * Icon definition with pre-computed measurements.
 */
export interface IconDefinition {
  id: string;
  svg: string;
  bytes: number;
}

/**
 * Raw SVG content for each whitelisted icon.
 * Minimal, hand-optimized SVGs.
 * viewBox standardized to 24x24, rendered at 16x16.
 */
const ICON_SVG: Record<string, string> = {
  'arrow-left':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',

  'arrow-right':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',

  'arrow-up':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',

  'arrow-down':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',

  'external-link':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>',

  'home':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',

  'menu':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>',

  'close':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',

  'check':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',

  'info':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',

  'warning':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>',

  'error':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',

  'mail':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>',

  'rss':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 11a9 9 0 019 9M4 4a16 16 0 0116 16"/><circle cx="5" cy="19" r="1"/></svg>',

  'calendar':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',

  'tag':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><circle cx="7" cy="7" r="1"/></svg>',
};

/**
 * Build the whitelist with pre-computed byte measurements.
 */
function buildWhitelist(): Map<string, IconDefinition> {
  const whitelist = new Map<string, IconDefinition>();

  for (const [id, svg] of Object.entries(ICON_SVG)) {
    whitelist.set(id, {
      id,
      svg,
      bytes: measureBytes(svg),
    });
  }

  return whitelist;
}

/**
 * The immutable icon whitelist.
 * Frozen at module load time.
 */
export const ICON_WHITELIST: ReadonlyMap<string, IconDefinition> = buildWhitelist();

/**
 * Get all available icon IDs.
 */
export function getAvailableIconIds(): string[] {
  return Array.from(ICON_WHITELIST.keys()).sort();
}

/**
 * Check if an icon ID exists in the whitelist.
 */
export function isValidIconId(id: string): boolean {
  return ICON_WHITELIST.has(id);
}

/**
 * Get an icon definition by ID.
 * Returns undefined if not in whitelist.
 */
export function getIcon(id: string): IconDefinition | undefined {
  return ICON_WHITELIST.get(id);
}

/**
 * Get icon SVG by ID.
 * Throws if not in whitelist - caller must validate first.
 */
export function getIconSvg(id: string): string {
  const icon = ICON_WHITELIST.get(id);
  if (!icon) {
    throw new Error(`Icon not in whitelist: ${id}`);
  }
  return icon.svg;
}

/**
 * Get icon byte cost by ID.
 * Throws if not in whitelist - caller must validate first.
 */
export function getIconBytes(id: string): number {
  const icon = ICON_WHITELIST.get(id);
  if (!icon) {
    throw new Error(`Icon not in whitelist: ${id}`);
  }
  return icon.bytes;
}
