/**
 * Input Validation
 *
 * Validates compiler input before processing.
 * All validation is strict - no coercion, no defaults.
 * Returns explicit errors on failure.
 */

import type {
  CompilerInput,
  CompilerError,
  ContentBlock,
  InlineNode,
  NavigationModule,
  FooterModule,
  CssModule,
  MetaModule,
  IconReference,
} from './types.js';
import { isValidIconId, getAvailableIconIds } from './icons.js';

/** Slug pattern: lowercase alphanumeric and hyphens */
const SLUG_PATTERN = /^[a-z0-9-]+$/;

/** Href pattern: relative paths, fragments, or simple absolute paths */
const HREF_PATTERN = /^(\/[a-z0-9._/-]*|#[a-z0-9-]*|[a-z0-9-]+\.html)$/i;

/** Maximum title length in characters */
const MAX_TITLE_LENGTH = 200;

/** Maximum meta description length in characters */
const MAX_META_DESCRIPTION_LENGTH = 160;

/** Maximum meta author length in characters */
const MAX_META_AUTHOR_LENGTH = 100;

/**
 * Result of validation.
 */
export type ValidationResult =
  | { valid: true }
  | { valid: false; error: CompilerError };

/**
 * Validate complete compiler input.
 */
export function validateInput(input: CompilerInput): ValidationResult {
  // Validate slug
  const slugResult = validateSlug(input.slug);
  if (!slugResult.valid) return slugResult;

  // Validate title
  const titleResult = validateTitle(input.title);
  if (!titleResult.valid) return titleResult;

  // Validate content
  const contentResult = validateContent(input.content);
  if (!contentResult.valid) return contentResult;

  // Validate navigation if present
  if (input.navigation !== null) {
    const navResult = validateNavigation(input.navigation);
    if (!navResult.valid) return navResult;
  }

  // Validate footer if present
  if (input.footer !== null) {
    const footerResult = validateFooter(input.footer);
    if (!footerResult.valid) return footerResult;
  }

  // Validate CSS if present
  if (input.css !== null) {
    const cssResult = validateCss(input.css);
    if (!cssResult.valid) return cssResult;
  }

  // Validate meta if present
  if (input.meta !== null) {
    const metaResult = validateMeta(input.meta);
    if (!metaResult.valid) return metaResult;
  }

  // Validate icons
  const iconsResult = validateIcons(input.icons);
  if (!iconsResult.valid) return iconsResult;

  return { valid: true };
}

/**
 * Validate slug format.
 */
export function validateSlug(slug: string): ValidationResult {
  if (!SLUG_PATTERN.test(slug)) {
    return {
      valid: false,
      error: {
        code: 'INVALID_SLUG',
        slug,
        pattern: SLUG_PATTERN.source,
      },
    };
  }
  return { valid: true };
}

/**
 * Validate title.
 */
export function validateTitle(title: string): ValidationResult {
  if (!title || title.trim().length === 0) {
    return {
      valid: false,
      error: {
        code: 'EMPTY_TITLE',
        message: 'Title cannot be empty',
      },
    };
  }

  if (title.length > MAX_TITLE_LENGTH) {
    return {
      valid: false,
      error: {
        code: 'TITLE_TOO_LONG',
        length: title.length,
        maxLength: MAX_TITLE_LENGTH,
      },
    };
  }

  return { valid: true };
}

/**
 * Validate content blocks.
 */
export function validateContent(blocks: ContentBlock[]): ValidationResult {
  if (blocks.length === 0) {
    return {
      valid: false,
      error: {
        code: 'CONTENT_EMPTY',
        message: 'At least one content block is required',
      },
    };
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const result = validateContentBlock(block, `content[${i}]`);
    if (!result.valid) return result;
  }
  return { valid: true };
}

/**
 * Validate a single content block.
 */
function validateContentBlock(
  block: ContentBlock,
  path: string
): ValidationResult {
  const blockType = block.type;
  
  if (blockType !== 'heading' && blockType !== 'paragraph' && blockType !== 'bloglist') {
    return {
      valid: false,
      error: {
        code: 'CONTENT_INVALID_ELEMENT',
        element: blockType,
        allowed: ['heading', 'paragraph', 'bloglist'],
        path,
      },
    };
  }

  if (blockType === 'heading') {
    if (
      block.level === undefined ||
      block.level < 1 ||
      block.level > 6
    ) {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: `heading with level ${block.level}`,
          allowed: ['heading with level 1-6'],
          path,
        },
      };
    }
  }

  // Bloglist blocks have no children to validate
  if (blockType !== 'bloglist') {
    // Validate inline nodes
    for (let i = 0; i < block.children.length; i++) {
      const node = block.children[i];
      const result = validateInlineNode(node, `${path}.children[${i}]`);
      if (!result.valid) return result;
    }
  }

  return { valid: true };
}

/**
 * Validate an inline node recursively.
 */
function validateInlineNode(node: InlineNode, path: string): ValidationResult {
  const allowedTypes = ['text', 'linebreak', 'bold', 'italic', 'link'];

  if (!allowedTypes.includes(node.type)) {
    return {
      valid: false,
      error: {
        code: 'CONTENT_INVALID_ELEMENT',
        element: node.type,
        allowed: allowedTypes,
        path,
      },
    };
  }

  if (node.type === 'text' || node.type === 'linebreak') {
    // Text and linebreak nodes are always valid
    return { valid: true };
  }

  if (node.type === 'link') {
    // Validate href
    const hrefResult = validateHref(node.href, path);
    if (!hrefResult.valid) return hrefResult;
  }

  // Validate children for bold, italic, link
  if ('children' in node && node.children) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const result = validateInlineNode(child, `${path}.children[${i}]`);
      if (!result.valid) return result;
    }
  }

  return { valid: true };
}

/**
 * Validate href format.
 */
export function validateHref(href: string, path?: string): ValidationResult {
  if (!HREF_PATTERN.test(href)) {
    return {
      valid: false,
      error: {
        code: 'INVALID_HREF',
        href,
        reason: 'Must be relative path, fragment, or .html file',
        path,
      },
    };
  }
  return { valid: true };
}

/**
 * Validate navigation module.
 */
export function validateNavigation(nav: NavigationModule): ValidationResult {
  for (let i = 0; i < nav.items.length; i++) {
    const item = nav.items[i];
    const path = `navigation.items[${i}]`;

    if (!item.text || item.text.trim().length === 0) {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: 'navigation item with empty text',
          allowed: ['navigation item with non-empty text'],
          path,
        },
      };
    }

    const hrefResult = validateHref(item.href, path);
    if (!hrefResult.valid) return hrefResult;
  }

  return { valid: true };
}

/**
 * Validate footer module.
 */
export function validateFooter(footer: FooterModule): ValidationResult {
  // Footer content can be empty, but must be a string
  if (typeof footer.content !== 'string') {
    return {
      valid: false,
      error: {
        code: 'CONTENT_INVALID_ELEMENT',
        element: 'footer with non-string content',
        allowed: ['footer with string content'],
      },
    };
  }
  return { valid: true };
}

/**
 * Validate CSS module.
 *
 * Performs basic syntax validation.
 * Does not validate CSS semantics.
 */
export function validateCss(css: CssModule): ValidationResult {
  const rules = css.rules;

  // Check for balanced braces
  let braceCount = 0;
  for (let i = 0; i < rules.length; i++) {
    const char = rules[i];
    if (char === '{') braceCount++;
    if (char === '}') braceCount--;

    if (braceCount < 0) {
      return {
        valid: false,
        error: {
          code: 'CSS_PARSE_ERROR',
          offset: i,
          message: 'Unexpected closing brace',
        },
      };
    }
  }

  if (braceCount !== 0) {
    return {
      valid: false,
      error: {
        code: 'CSS_PARSE_ERROR',
        offset: rules.length,
        message: 'Unbalanced braces',
      },
    };
  }

  return { valid: true };
}

/**
 * Validate meta module.
 */
export function validateMeta(meta: MetaModule): ValidationResult {
  if (meta.description !== undefined) {
    if (typeof meta.description !== 'string') {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: 'meta description with non-string value',
          allowed: ['meta description with string value'],
        },
      };
    }
    if (meta.description.length > MAX_META_DESCRIPTION_LENGTH) {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: `meta description with ${meta.description.length} characters`,
          allowed: [`meta description with max ${MAX_META_DESCRIPTION_LENGTH} characters`],
        },
      };
    }
  }

  if (meta.author !== undefined) {
    if (typeof meta.author !== 'string') {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: 'meta author with non-string value',
          allowed: ['meta author with string value'],
        },
      };
    }
    if (meta.author.length > MAX_META_AUTHOR_LENGTH) {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: `meta author with ${meta.author.length} characters`,
          allowed: [`meta author with max ${MAX_META_AUTHOR_LENGTH} characters`],
        },
      };
    }
  }

  return { valid: true };
}

/**
 * Validate icon references.
 */
export function validateIcons(icons: IconReference[]): ValidationResult {
  const available = getAvailableIconIds();

  for (let i = 0; i < icons.length; i++) {
    const icon = icons[i];
    if (!isValidIconId(icon.id)) {
      return {
        valid: false,
        error: {
          code: 'ICON_NOT_IN_WHITELIST',
          iconId: icon.id,
          available,
          path: `icons[${i}]`,
        },
      };
    }
  }

  return { valid: true };
}
