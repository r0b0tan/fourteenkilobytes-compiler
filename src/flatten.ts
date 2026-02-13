/**
 * Flattening Stage
 *
 * Transforms abstract input into concrete HTML fragments.
 * Authoring abstractions disappear entirely here.
 * Output is raw HTML strings ready for measurement and assembly.
 */

import type {
  CompilerInput,
  ClassManglingMode,
  ContentBlock,
  InlineNode,
  FlattenedPage,
  FlattenedContentBlock,
  ModuleBreakdown,
  Post,
  BloglistBlock,
} from './types.js';
import { measureBytes, normalizeLineEndings, sanitizeHtml } from './measure.js';
import { getIconSvg, getIconBytes } from './icons.js';

/**
 * HTML escape map for content.
 */
const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const SAFE_GENERATED_CLASS_MAP: Record<string, string> = {
  layout: 'l',
  cell: 'c',
  'bg-pattern-dots': 'pd',
  'bg-pattern-grid': 'pg',
  'bg-pattern-stripes': 'ps',
  'bg-pattern-cross': 'pc',
  'bg-pattern-hexagons': 'ph',
};

const AGGRESSIVE_GENERATED_CLASS_MAP: Record<string, string> = {
  ...SAFE_GENERATED_CLASS_MAP,
  pagination: 'p',
  posts: 's',
  post: 't',
  'archive-link': 'al',
  'end-of-list': 'el',
  empty: 'e',
};

const DEFAULTS = {
  layoutCell: {
    textAlign: 'start',
    padding: '10px',
    margin: '10px',
  },
  layout: {
    columns: 1,
    rowGap: '0',
    columnGap: '0',
  },
  section: {
    background: 'transparent',
    color: 'inherit',
    patternOpacity: '0',
    width: '100%',
    padding: '3rem',
    align: 'start',
  },
} as const;

function isLayoutCellDefaultTextAlign(value?: string | null): boolean {
  return value === 'start' || value === null || value === undefined || value === '';
}

function normalizeAlignment(value?: string | null): 'start' | 'left' | 'center' | 'right' | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === 'left' || normalized === 'links') return 'left';
  if (normalized === 'right' || normalized === 'rechts') return 'right';
  if (normalized === 'center' || normalized === 'centre' || normalized === 'mittig' || normalized === 'mitte') return 'center';
  if (normalized === 'start') return 'start';

  return null;
}

function normalizeCssLength(value?: string | null): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;

  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return `${normalized}px`;
  }

  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeClassManglingMode(enabled: boolean, mode?: ClassManglingMode): ClassManglingMode {
  if (!enabled) return 'safe';
  return mode === 'aggressive' ? 'aggressive' : 'safe';
}

function getGeneratedClassMap(mode: ClassManglingMode): Record<string, string> {
  return mode === 'aggressive' ? AGGRESSIVE_GENERATED_CLASS_MAP : SAFE_GENERATED_CLASS_MAP;
}

function mangleGeneratedClass(className: string, enabled: boolean, mode: ClassManglingMode = 'safe'): string {
  if (!enabled) return className;
  const classMap = getGeneratedClassMap(mode);
  return classMap[className] || className;
}

function mangleCssClassSelectors(css: string, enabled: boolean, mode: ClassManglingMode = 'safe'): string {
  if (!css) return css;

  let result = css;

  // Backward compatibility: allow legacy `.section` selectors to target
  // semantic `<section>` elements without requiring class="section" in output.
  result = result.replace(/\.section(?![a-zA-Z0-9_-])/g, 'section');

  if (!enabled) return result;

  const classMap = getGeneratedClassMap(mode);
  for (const [fromClass, toClass] of Object.entries(classMap)) {
    if (fromClass === toClass) continue;
    const selectorRegex = new RegExp(`\\.${escapeRegExp(fromClass)}(?![a-zA-Z0-9_-])`, 'g');
    result = result.replace(selectorRegex, `.${toClass}`);
  }
  return result;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (char) => HTML_ESCAPE[char]);
}

function parseSelector(selector?: string | null): { id: string; classes: string[] } {
  if (!selector || typeof selector !== 'string') {
    return { id: '', classes: [] };
  }

  const safeToken = (token: string): string => {
    if (!token) return '';
    return token.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  };

  const normalized = selector.trim();
  if (!normalized) return { id: '', classes: [] };

  if (normalized.startsWith('#')) {
    const [idToken, ...classTokens] = normalized.slice(1).split('.');
    const id = safeToken(idToken);
    const classes = classTokens.map(safeToken).filter(Boolean);
    return { id, classes };
  }

  const source = normalized.startsWith('.') ? normalized.slice(1) : normalized;
  const classes = source
    .split(/[.\s]+/)
    .map(safeToken)
    .filter(Boolean);
  return { id: '', classes };
}

function selectorAttrs(selector?: string | null, baseClasses: string[] = []): string {
  const parsed = parseSelector(selector);
  const classes = [...baseClasses, ...parsed.classes].filter(Boolean);
  const idAttr = parsed.id ? ` id="${escapeHtml(parsed.id)}"` : '';
  const classAttr = classes.length > 0 ? ` class="${escapeHtml(classes.join(' '))}"` : '';
  return `${idAttr}${classAttr}`;
}

/**
 * Result of flattening: the page and its measurement breakdown.
 */
export interface FlattenResult {
  page: FlattenedPage;
  contentBlocks: FlattenedContentBlock[];
  breakdown: ModuleBreakdown;
  iconBytes: number;
}

/**
 * Flatten compiler input into HTML fragments.
 */
export function flatten(input: CompilerInput): FlattenResult {
  const breakdown: ModuleBreakdown = {
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

  // Calculate icon bytes
  let iconBytes = 0;
  for (const iconRef of input.icons) {
    iconBytes += getIconBytes(iconRef.id);
  }
  breakdown.icons = iconBytes;

  // Build head content - compute final title
  let finalTitle = input.title;
  if (input.titleOverride) {
    // Use override if provided
    finalTitle = input.titleOverride;
  } else if (input.siteTitle) {
    // Append site title: "Page Title | Site Title"
    finalTitle = `${input.title} | ${input.siteTitle}`;
  }
  const titleHtml = `<title>${escapeHtml(finalTitle)}</title>`;
  breakdown.title = measureBytes(titleHtml);

  let cssHtml = '';
  const classManglingEnabled = input.classMangling === true;
  const classManglingMode = normalizeClassManglingMode(classManglingEnabled, input.classManglingMode);
  const rawCssRules = input.css ? input.css.rules.trim() : '';
  const cssRules = mangleCssClassSelectors(rawCssRules, classManglingEnabled, classManglingMode);
  if (cssRules) {
    cssHtml = `<style>${cssRules}</style>`;
    breakdown.css = measureBytes(cssHtml);
  }

  // Build favicon link
  let faviconHtml = '';
  if (input.favicon) {
    faviconHtml = `<link rel="icon" href="${input.favicon}">`;
    breakdown.favicon = measureBytes(faviconHtml);
  }

  // Build meta tags
  let metaHtml = '';
  if (input.meta !== null) {
    const metaParts: string[] = [];
    if (input.meta.description) {
      metaParts.push(`<meta name="description" content="${escapeHtml(input.meta.description)}">`);
    }
    if (input.meta.author) {
      metaParts.push(`<meta name="author" content="${escapeHtml(input.meta.author)}">`);
    }
    if (metaParts.length > 0) {
      metaHtml = metaParts.join('\n');
      breakdown.meta = measureBytes(metaHtml);
    }
  }

  const headContent = `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n${titleHtml}${faviconHtml ? '\n' + faviconHtml : ''}${metaHtml ? '\n' + metaHtml : ''}${cssHtml ? '\n' + cssHtml : ''}`;
  const head = `<head>\n${headContent}\n</head>`;

  // Build navigation
  let navigation = '';
  if (input.navigation !== null) {
    const navItems = input.navigation.items
      .map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.text)}</a>`)
      .join('\n');
    navigation = `<header><nav>\n${navItems}\n</nav></header>`;
    breakdown.navigation = measureBytes(navigation);
  }

  // Build footer
  let footer = '';
  if (input.footer !== null) {
    footer = `<footer>${sanitizeHtml(input.footer.content)}</footer>`;
    breakdown.footer = measureBytes(footer);
  }

  // Build content blocks individually for pagination support
  // Bloglist blocks are expanded into individual items for pagination
  const contentBlocks: FlattenedContentBlock[] = [];
  input.content.forEach((block, index) => {
    if (block.type === 'bloglist') {
      // Expand bloglist into individual items for pagination
      const bloglistBlocks = flattenBloglistToItems(
        input.posts || [],
        block as BloglistBlock,
        index,
        classManglingEnabled,
        classManglingMode
      );
      contentBlocks.push(...bloglistBlocks);
    } else {
      const html = flattenContentBlock(block, input.icons, input.posts, classManglingEnabled, classManglingMode);
      contentBlocks.push({
        html,
        bytes: measureBytes(html),
        sourceIndex: index,
      });
    }
  });

  // Calculate total content bytes
  const contentHtml = contentBlocks.map((b) => b.html).join('\n');
  breakdown.content = measureBytes(contentHtml);

  // Static structure
  const doctype = '<!DOCTYPE html>';
  const htmlOpen = '<html lang="en">';
  const bodyOpen = '<body>';
  const mainOpen = '<main>';
  const mainClose = '</main>';
  const bodyClose = '</body>';
  const htmlClose = '</html>';

  // Calculate head structure bytes WITHOUT title, favicon, meta, and css content
  // (title, favicon, meta, and css are tracked separately in breakdown)
  // Head structure: <head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n[title][optional \n favicon][optional \n meta][optional \n css]\n</head>
  const headStructureBytes =
    measureBytes('<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n') +
    (faviconHtml ? measureBytes('\n') : 0) + // newline between title and favicon
    (metaHtml ? measureBytes('\n') : 0) + // newline between favicon/title and meta
    (cssHtml ? measureBytes('\n') : 0) + // newline between meta/title and css
    measureBytes('\n</head>');

  // Base bytes: structure without modules
  breakdown.base =
    measureBytes(doctype) +
    measureBytes('\n') +
    measureBytes(htmlOpen) +
    measureBytes('\n') +
    headStructureBytes +
    measureBytes('\n') +
    measureBytes(bodyOpen) +
    measureBytes('\n') +
    measureBytes(mainOpen) +
    measureBytes('\n') +
    measureBytes(mainClose) +
    measureBytes('\n') +
    measureBytes(bodyClose) +
    measureBytes('\n') +
    measureBytes(htmlClose);

  // Adjust for actual content newlines
  if (navigation) breakdown.base += measureBytes('\n');
  if (contentHtml) breakdown.base += measureBytes('\n');
  if (footer) breakdown.base += measureBytes('\n');

  const page: FlattenedPage = {
    doctype,
    htmlOpen,
    head,
    bodyOpen,
    navigation,
    mainOpen,
    content: contentHtml,
    mainClose,
    footer,
    bodyClose,
    htmlClose,
  };

  return {
    page,
    contentBlocks,
    breakdown,
    iconBytes,
  };
}

/**
 * Flatten a single content block to HTML.
 */
function flattenContentBlock(
  block: ContentBlock,
  icons: { id: string; placement: string; index: number }[],
  posts?: Post[],
  classManglingEnabled: boolean = false,
  classManglingMode: ClassManglingMode = 'safe'
): string {
  if (block.type === 'bloglist') {
    const bloglistHtml = renderBloglist(posts || [], block as BloglistBlock, classManglingEnabled, classManglingMode);
    if (!block.selector) return bloglistHtml;
    return `<div${selectorAttrs(block.selector)}>${bloglistHtml}</div>`;
  }

  if (block.type === 'divider') {
    return `<hr${selectorAttrs(block.selector)}>`;
  }

  if (block.type === 'spacer') {
    const height = block.height && block.height.trim() ? block.height.trim() : '1rem';
    return `<div${selectorAttrs(block.selector)} style="height:${height}"></div>`;
  }

  if (block.type === 'codeblock') {
    return `<pre${selectorAttrs(block.selector)}><code>${escapeHtml(block.content)}</code></pre>`;
  }

  if (block.type === 'unordered-list' || block.type === 'ordered-list') {
    const tag = block.type === 'unordered-list' ? 'ul' : 'ol';
    const items = block.items
      .map((item) => {
        const inlineHtml = flattenInlineNodes(item.children, icons, 'content');
        return `<li>${inlineHtml}</li>`;
      })
      .join('\n');
    return `<${tag}${selectorAttrs(block.selector)}>\n${items}\n</${tag}>`;
  }

  if (block.type === 'layout') {
    // Build grid cells HTML
    const cellsHtml = block.cells
      .map((cell) => {
        const cellContent = cell.children
          .map((child) => flattenContentBlock(child, icons, posts, classManglingEnabled, classManglingMode))
          .join('\n');
        const cellStyles: string[] = [];
        const textAlign = normalizeAlignment(cell.textAlign);
        const padding = normalizeCssLength(cell.padding);
        const margin = normalizeCssLength(cell.margin);

        if (textAlign && !isLayoutCellDefaultTextAlign(textAlign)) cellStyles.push(`text-align:${textAlign}`);
        if (padding && padding !== DEFAULTS.layoutCell.padding) cellStyles.push(`padding:${padding}`);
        if (margin && margin !== DEFAULTS.layoutCell.margin) cellStyles.push(`margin:${margin}`);
        const cellStyle = cellStyles.length ? ` style="${cellStyles.join(';')}"` : '';
        return `<div class="${mangleGeneratedClass('cell', classManglingEnabled, classManglingMode)}"${cellStyle}>${cellContent}</div>`;
      })
      .join('\n');

    // Build style string for grid
    const styles: string[] = [];
    styles.push(`display:inline-grid`);
    styles.push(`width:fit-content`);
    styles.push(`max-width:100%`);
    if (block.columns !== DEFAULTS.layout.columns) {
      styles.push(`grid-template-columns:repeat(${block.columns},1fr)`);
    }

    if (block.rows) {
      styles.push(`grid-template-rows:repeat(${block.rows},auto)`);
    }

    // Handle gaps
    const rowGap = block.rowGap || DEFAULTS.layout.rowGap;
    const colGap = block.columnGap || DEFAULTS.layout.columnGap;
    if (!(rowGap === DEFAULTS.layout.rowGap && colGap === DEFAULTS.layout.columnGap)) {
      if (rowGap === colGap) {
        styles.push(`gap:${rowGap}`);
      } else {
        styles.push(`gap:${rowGap} ${colGap}`);
      }
    }

    const styleAttr = ` style="${styles.join(';')}"`;

    // Build class string
    const classes = [mangleGeneratedClass('layout', classManglingEnabled, classManglingMode)];
    if (block.className) {
      classes.push(block.className);
    }

    return `<div${selectorAttrs(block.selector, classes)}${styleAttr}>${cellsHtml}</div>`;
  }

  if (block.type === 'section') {
    const childrenHtml = block.children
      .map(child => flattenContentBlock(child, icons, posts, classManglingEnabled, classManglingMode))
      .join('\n');

    const sectionAlign = normalizeAlignment(block.align);
    const sectionPadding = normalizeCssLength(block.padding);

    // Build style string — all values as CSS custom properties
    // so user CSS can override them without !important
    const styles: string[] = [];
    if (block.background && block.background !== DEFAULTS.section.background) styles.push(`--sb:${block.background}`);
    if (block.color && block.color !== DEFAULTS.section.color) styles.push(`--sc:${block.color}`);
    if (block.pattern && block.patternColor && block.patternOpacity && block.patternOpacity !== DEFAULTS.section.patternOpacity) {
      const hex = block.patternColor;
      const opacity = block.patternOpacity;
       const r = parseInt(hex.substring(1,3), 16);
       const g = parseInt(hex.substring(3,5), 16);
       const b = parseInt(hex.substring(5,7), 16);
       styles.push(`--pc:rgba(${r},${g},${b},${opacity})`);
    }
    if (block.width && block.width !== DEFAULTS.section.width) styles.push(`--sw:${block.width}`);
    if (sectionPadding && sectionPadding !== DEFAULTS.section.padding) styles.push(`--sp:${sectionPadding}`);
    if (sectionAlign && sectionAlign !== DEFAULTS.section.align) styles.push(`--sa:${sectionAlign}`);

    const styleAttr = styles.length > 0 ? ` style="${styles.join(';')}"` : '';

    // Build class string
    const classes: string[] = [];
    if (block.pattern) {
      if (block.pattern === 'dots') classes.push(mangleGeneratedClass('bg-pattern-dots', classManglingEnabled, classManglingMode));
      if (block.pattern === 'grid') classes.push(mangleGeneratedClass('bg-pattern-grid', classManglingEnabled, classManglingMode));
      if (block.pattern === 'stripes') classes.push(mangleGeneratedClass('bg-pattern-stripes', classManglingEnabled, classManglingMode));
      if (block.pattern === 'cross') classes.push(mangleGeneratedClass('bg-pattern-cross', classManglingEnabled, classManglingMode));
      if (block.pattern === 'hexagons') classes.push(mangleGeneratedClass('bg-pattern-hexagons', classManglingEnabled, classManglingMode));
    }

    return `<section${selectorAttrs(block.selector, classes)}${styleAttr}>${childrenHtml}</section>`;
  }

  const inlineHtml = flattenInlineNodes(block.children, icons, 'content');

  if (block.type === 'heading') {
    const level = block.level ?? 1;
    return `<h${level}${selectorAttrs(block.selector)}>${inlineHtml}</h${level}>`;
  }

  if (block.type === 'blockquote') {
    return `<blockquote${selectorAttrs(block.selector)}>${inlineHtml}</blockquote>`;
  }

  return `<p${selectorAttrs(block.selector)}>${inlineHtml}</p>`;
}

/** Default limit for bloglist if not specified */
const DEFAULT_BLOGLIST_LIMIT = 20;

/**
 * Render a bloglist from post metadata (legacy, single block).
 * Used when bloglist doesn't need pagination.
 */
function renderBloglist(
  posts: Post[],
  block?: BloglistBlock,
  classManglingEnabled: boolean = false,
  classManglingMode: ClassManglingMode = 'safe'
): string {
  const published = posts.filter(p => p.status === 'published' && p.pageType === 'post');

  if (published.length === 0) {
    return `<p class="${mangleGeneratedClass('empty', classManglingEnabled, classManglingMode)}">Noch keine Posts.</p>`;
  }

  published.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  // Apply limit: use block.limit if set, otherwise default to 20
  // null means "no limit" (show all posts)
  const limit = block?.limit === null ? published.length : (block?.limit ?? DEFAULT_BLOGLIST_LIMIT);
  const limitedPosts = published.slice(0, limit);

  const items = limitedPosts.map(post => {
    const date = new Date(post.publishedAt).toLocaleDateString('de-DE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    return `<li class="${mangleGeneratedClass('post', classManglingEnabled, classManglingMode)}"><a href="/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a> - <time datetime="${escapeHtml(post.publishedAt)}">${date}</time></li>`;
  }).join('\n');

  let html = `<ul class="${mangleGeneratedClass('posts', classManglingEnabled, classManglingMode)}">\n${items}\n</ul>`;

  // Add archive link if configured
  if (block?.archiveLink) {
    html += `\n<p class="${mangleGeneratedClass('archive-link', classManglingEnabled, classManglingMode)}"><a href="${escapeHtml(block.archiveLink.href)}">${escapeHtml(block.archiveLink.text)}</a></p>`;
  }

  return html;
}

/**
 * Flatten a bloglist into individual items for pagination support.
 * Each post becomes a separate FlattenedContentBlock with blockType='bloglist-item'.
 * The archive link (if present) becomes a separate block with blockType='bloglist-archive-link'.
 */
function flattenBloglistToItems(
  posts: Post[],
  block: BloglistBlock,
  sourceIndex: number,
  classManglingEnabled: boolean = false,
  classManglingMode: ClassManglingMode = 'safe'
): FlattenedContentBlock[] {
  const published = posts.filter(p => p.status === 'published' && p.pageType === 'post');

  if (published.length === 0) {
    // Return empty message as a single block
    const html = `<p class="${mangleGeneratedClass('empty', classManglingEnabled, classManglingMode)}">Noch keine Posts.</p>`;
    return [{
      html,
      bytes: measureBytes(html),
      sourceIndex,
    }];
  }

  published.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  // Apply limit
  const limit = block?.limit === null ? published.length : (block?.limit ?? DEFAULT_BLOGLIST_LIMIT);
  const limitedPosts = published.slice(0, limit);

  // Create individual blocks for each post item
  const blocks: FlattenedContentBlock[] = limitedPosts.map(post => {
    const date = new Date(post.publishedAt).toLocaleDateString('de-DE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const html = `<li class="${mangleGeneratedClass('post', classManglingEnabled, classManglingMode)}"><a href="/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a> - <time datetime="${escapeHtml(post.publishedAt)}">${date}</time></li>`;
    return {
      html,
      bytes: measureBytes(html),
      sourceIndex,
      blockType: 'bloglist-item' as const,
    };
  });

  // Add archive link as separate block if configured
  if (block?.archiveLink) {
    const archiveHtml = `<p class="${mangleGeneratedClass('archive-link', classManglingEnabled, classManglingMode)}"><a href="${escapeHtml(block.archiveLink.href)}">${escapeHtml(block.archiveLink.text)}</a></p>`;
    blocks.push({
      html: archiveHtml,
      bytes: measureBytes(archiveHtml),
      sourceIndex,
      blockType: 'bloglist-archive-link' as const,
    });
  } else if (block?.limit === null) {
    // For full lists (archive page) with no archive link, add "End of list" marker
    const endHtml = `<p class="${mangleGeneratedClass('end-of-list', classManglingEnabled, classManglingMode)}">— Ende der Liste —</p>`;
    blocks.push({
      html: endHtml,
      bytes: measureBytes(endHtml),
      sourceIndex,
      blockType: 'bloglist-archive-link' as const, // Same type so it's handled the same way
    });
  }

  return blocks;
}

/**
 * Flatten inline nodes to HTML.
 */
function flattenInlineNodes(
  nodes: InlineNode[],
  icons: { id: string; placement: string; index: number }[],
  placement: string
): string {
  return nodes
    .map((node, index) => flattenInlineNode(node, icons, placement, index))
    .join('');
}

/**
 * Flatten a single inline node to HTML.
 */
function flattenInlineNode(
  node: InlineNode,
  icons: { id: string; placement: string; index: number }[],
  placement: string,
  index: number
): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.text);

    case 'linebreak':
      return '<br>';

    case 'bold':
      return `<b>${flattenInlineNodes(node.children, icons, placement)}</b>`;

    case 'italic':
      return `<i>${flattenInlineNodes(node.children, icons, placement)}</i>`;

    case 'underline':
      return `<u>${flattenInlineNodes(node.children, icons, placement)}</u>`;

    case 'strikethrough':
      return `<s>${flattenInlineNodes(node.children, icons, placement)}</s>`;

    case 'code':
      return `<code>${flattenInlineNodes(node.children, icons, placement)}</code>`;

    case 'link': {
      const childHtml = flattenInlineNodes(node.children, icons, placement);
      // Check for icon at this position
      const icon = icons.find(
        (i) => i.placement === placement && i.index === index
      );
      const iconHtml = icon ? getIconSvg(icon.id) : '';
      return `<a href="${escapeHtml(node.href)}">${childHtml}${iconHtml}</a>`;
    }
  }
}

/**
 * Assemble a complete HTML page from flattened parts.
 */
export function assemblePage(page: FlattenedPage): string {
  const parts: string[] = [page.doctype, page.htmlOpen, page.head, page.bodyOpen];

  if (page.navigation) {
    parts.push(page.navigation);
  }

  parts.push(page.mainOpen);

  if (page.content) {
    parts.push(page.content);
  }

  parts.push(page.mainClose);

  if (page.footer) {
    parts.push(page.footer);
  }

  parts.push(page.bodyClose, page.htmlClose);

  return normalizeLineEndings(parts.join('\n'));
}

/**
 * Assemble a page with custom content (for pagination).
 */
export function assemblePageWithContent(
  page: FlattenedPage,
  contentHtml: string,
  paginationHtml: string
): string {
  const parts: string[] = [page.doctype, page.htmlOpen, page.head, page.bodyOpen];

  if (page.navigation) {
    parts.push(page.navigation);
  }

  parts.push(page.mainOpen);

  if (contentHtml) {
    parts.push(contentHtml);
  }

  if (paginationHtml) {
    parts.push(paginationHtml);
  }

  parts.push(page.mainClose);

  if (page.footer) {
    parts.push(page.footer);
  }

  parts.push(page.bodyClose, page.htmlClose);

  return normalizeLineEndings(parts.join('\n'));
}



