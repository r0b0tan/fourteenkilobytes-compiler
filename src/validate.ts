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
  BloglistBlock,
  AuthorBlock,
} from './types.js';
import { isValidIconId, getAvailableIconIds } from './icons.js';

/** Slug pattern: lowercase alphanumeric and hyphens */
const SLUG_PATTERN = /^[a-z0-9-]+$/;

/** Href pattern: relative paths, fragments, absolute URLs, or simple file references */
const HREF_PATTERN = /^(\/[a-z0-9._/-]*|#[a-z0-9-]*|[a-z0-9-]+\.html|https?:\/\/[^\s]+|mailto:[^\s]+|tel:[^\s]+)$/i;

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
  path: string,
  disallowNesting: boolean = false
): ValidationResult {
  const blockType = block.type;
  const allowedBlockTypes = ['heading', 'paragraph', 'bloglist', 'author', 'unordered-list', 'ordered-list', 'blockquote', 'codeblock', 'divider', 'spacer', 'section', 'layout'];

  if (!allowedBlockTypes.includes(blockType)) {
    return {
      valid: false,
      error: {
        code: 'CONTENT_INVALID_ELEMENT',
        element: blockType,
        allowed: allowedBlockTypes,
        path,
      },
    };
  }

  if ((block as { selector?: unknown }).selector !== undefined && typeof (block as { selector?: unknown }).selector !== 'string') {
    return {
      valid: false,
      error: {
        code: 'CONTENT_INVALID_ELEMENT',
        element: `${blockType} with non-string selector`,
        allowed: [`${blockType} with string selector or no selector`],
        path,
      },
    };
  }

  // Disallow section and layout in nested contexts (e.g., inside layout cells)
  if (disallowNesting && (blockType === 'section' || blockType === 'layout')) {
    return {
      valid: false,
      error: {
        code: 'CONTENT_INVALID_ELEMENT',
        element: blockType,
        allowed: ['heading', 'paragraph', 'bloglist', 'author', 'unordered-list', 'ordered-list', 'blockquote', 'codeblock', 'divider', 'spacer'],
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

  // Validate list blocks
  if (blockType === 'unordered-list' || blockType === 'ordered-list') {
    if (!block.items || !Array.isArray(block.items)) {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: `${blockType} without items array`,
          allowed: [`${blockType} with items array`],
          path,
        },
      };
    }
    for (let i = 0; i < block.items.length; i++) {
      const item = block.items[i];
      if (!item.children || !Array.isArray(item.children)) {
        return {
          valid: false,
          error: {
            code: 'CONTENT_INVALID_ELEMENT',
            element: 'list item without children',
            allowed: ['list item with children array'],
            path: `${path}.items[${i}]`,
          },
        };
      }
      for (let j = 0; j < item.children.length; j++) {
        const node = item.children[j];
        const result = validateInlineNode(node, `${path}.items[${i}].children[${j}]`);
        if (!result.valid) return result;
      }
    }
    return { valid: true };
  }

  // Codeblock has plain text content, no inline nodes
  if (blockType === 'codeblock') {
    if (typeof block.content !== 'string') {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: 'codeblock without string content',
          allowed: ['codeblock with string content'],
          path,
        },
      };
    }
    return { valid: true };
  }

  // Divider blocks have no children to validate
  if (blockType === 'divider') {
    return { valid: true };
  }

  if (blockType === 'spacer') {
    if ((block as { height?: unknown }).height !== undefined && typeof (block as { height?: unknown }).height !== 'string') {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: 'spacer with non-string height',
          allowed: ['spacer with string height or no height'],
          path,
        },
      };
    }
    return { valid: true };
  }

  // Validate bloglist block options
  if (blockType === 'bloglist') {
    const bloglistResult = validateBloglistBlock(block as BloglistBlock, path);
    if (!bloglistResult.valid) return bloglistResult;
    return { valid: true };
  }

  if (blockType === 'author') {
    const authorResult = validateAuthorBlock(block as AuthorBlock, path);
    if (!authorResult.valid) return authorResult;
    return { valid: true };
  }

  // Validate layout blocks
  if (blockType === 'layout') {
    // Validate columns
    if (typeof block.columns !== 'number' || block.columns < 1 || block.columns > 12) {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: `layout with columns ${block.columns}`,
          allowed: ['layout with columns 1-12'],
          path,
        },
      };
    }

    // Validate rows if present
    if (block.rows !== null && block.rows !== undefined) {
      if (typeof block.rows !== 'number' || block.rows < 1) {
        return {
          valid: false,
          error: {
            code: 'CONTENT_INVALID_ELEMENT',
            element: `layout with rows ${block.rows}`,
            allowed: ['layout with rows >= 1 or null for auto'],
            path,
          },
        };
      }
    }

    // Validate cells
    if (!block.cells || !Array.isArray(block.cells)) {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: 'layout without cells array',
          allowed: ['layout with cells array'],
          path,
        },
      };
    }

    // Validate each cell's children (no section/layout allowed)
    for (let i = 0; i < block.cells.length; i++) {
      const cell = block.cells[i];
      if (!cell.children || !Array.isArray(cell.children)) {
        return {
          valid: false,
          error: {
            code: 'CONTENT_INVALID_ELEMENT',
            element: 'layout cell without children array',
            allowed: ['layout cell with children array'],
            path: `${path}.cells[${i}]`,
          },
        };
      }
      for (let j = 0; j < cell.children.length; j++) {
        const result = validateContentBlock(cell.children[j], `${path}.cells[${i}].children[${j}]`, true);
        if (!result.valid) return result;
      }
    }

    return { valid: true };
  }

  // Validate section blocks (nested blocks)
  if (blockType === 'section') {
     if (block.children) {
      for (let i = 0; i < block.children.length; i++) {
        const result = validateContentBlock(block.children[i], `${path}.children[${i}]`);
        if (!result.valid) return result;
      }
    }
    return { valid: true };
  }

  // Validate inline nodes for paragraph, heading, blockquote
  for (let i = 0; i < block.children.length; i++) {
    const node = block.children[i];
    const result = validateInlineNode(node, `${path}.children[${i}]`);
    if (!result.valid) return result;
  }

  return { valid: true };
}

/**
 * Validate an inline node recursively.
 */
function validateInlineNode(node: InlineNode, path: string): ValidationResult {
  const allowedTypes = ['text', 'linebreak', 'bold', 'italic', 'underline', 'strikethrough', 'code', 'link'];

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

  // Validate children for bold, italic, underline, strikethrough, code, link
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
        reason: 'Must be relative path, fragment, URL, or .html file',
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
 * Validate bloglist block options.
 */
export function validateBloglistBlock(block: BloglistBlock, path: string): ValidationResult {
  // Validate limit if present
  if (block.limit !== undefined && block.limit !== null) {
    if (typeof block.limit !== 'number' || !Number.isInteger(block.limit) || block.limit < 1) {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: `bloglist with invalid limit: ${block.limit}`,
          allowed: ['bloglist with positive integer limit or no limit'],
          path,
        },
      };
    }
  }

  // Validate archiveLink if present
  if (block.archiveLink !== undefined) {
    if (typeof block.archiveLink !== 'object' || block.archiveLink === null) {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: 'bloglist with invalid archiveLink',
          allowed: ['bloglist with archiveLink object containing href and text'],
          path,
        },
      };
    }

    // Validate archiveLink.href
    const hrefResult = validateHref(block.archiveLink.href, `${path}.archiveLink.href`);
    if (!hrefResult.valid) return hrefResult;

    // Validate archiveLink.text
    if (!block.archiveLink.text || block.archiveLink.text.trim().length === 0) {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: 'bloglist archiveLink with empty text',
          allowed: ['bloglist archiveLink with non-empty text'],
          path: `${path}.archiveLink.text`,
        },
      };
    }
  }

  return { valid: true };
}

/**
 * Validate author block options.
 */
export function validateAuthorBlock(block: AuthorBlock, path: string): ValidationResult {
  const boolFields: Array<keyof AuthorBlock> = ['showPublished', 'showModified', 'showAuthor'];
  for (const field of boolFields) {
    const value = block[field];
    if (value !== undefined && typeof value !== 'boolean') {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: `author with non-boolean ${String(field)}`,
          allowed: [`author with boolean ${String(field)} or no ${String(field)}`],
          path,
        },
      };
    }
  }

  if (block.tags !== undefined) {
    if (!Array.isArray(block.tags)) {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: 'author with non-array tags',
          allowed: ['author with tags string array'],
          path,
        },
      };
    }

    if (block.tags.length > 8) {
      return {
        valid: false,
        error: {
          code: 'CONTENT_INVALID_ELEMENT',
          element: `author with ${block.tags.length} tags`,
          allowed: ['author with up to 8 tags'],
          path,
        },
      };
    }

    for (let index = 0; index < block.tags.length; index++) {
      const tag = block.tags[index];
      if (typeof tag !== 'string') {
        return {
          valid: false,
          error: {
            code: 'CONTENT_INVALID_ELEMENT',
            element: 'author with non-string tag',
            allowed: ['author tags with string values'],
            path: `${path}.tags[${index}]`,
          },
        };
      }

      if (tag.length > 32) {
        return {
          valid: false,
          error: {
            code: 'CONTENT_INVALID_ELEMENT',
            element: `author tag with ${tag.length} characters`,
            allowed: ['author tags with max 32 characters'],
            path: `${path}.tags[${index}]`,
          },
        };
      }
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
