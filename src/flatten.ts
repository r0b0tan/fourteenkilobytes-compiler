/**
 * Flattening Stage
 *
 * Transforms abstract input into concrete HTML fragments.
 * Authoring abstractions disappear entirely here.
 * Output is raw HTML strings ready for measurement and assembly.
 */

import type {
  CompilerInput,
  ContentBlock,
  InlineNode,
  FlattenedPage,
  FlattenedContentBlock,
  ModuleBreakdown,
  Post,
  BloglistBlock,
} from './types.js';
import { measureBytes, normalizeLineEndings } from './measure.js';
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

/**
 * Escape HTML special characters.
 */
function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (char) => HTML_ESCAPE[char]);
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
  if (input.css !== null) {
    cssHtml = `<style>${input.css.rules}</style>`;
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

  const headContent = `<meta charset="utf-8">\n${titleHtml}${faviconHtml ? '\n' + faviconHtml : ''}${metaHtml ? '\n' + metaHtml : ''}${cssHtml ? '\n' + cssHtml : ''}`;
  const head = `<head>\n${headContent}\n</head>`;

  // Build navigation
  let navigation = '';
  if (input.navigation !== null) {
    const navItems = input.navigation.items
      .map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.text)}</a>`)
      .join('\n');
    navigation = `<nav>\n${navItems}\n</nav>`;
    breakdown.navigation = measureBytes(navigation);
  }

  // Build footer
  let footer = '';
  if (input.footer !== null) {
    footer = `<footer>${escapeHtml(input.footer.content)}</footer>`;
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
        index
      );
      contentBlocks.push(...bloglistBlocks);
    } else {
      const html = flattenContentBlock(block, input.icons, input.posts);
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
  const bodyClose = '</body>';
  const htmlClose = '</html>';

  // Calculate head structure bytes WITHOUT title, favicon, meta, and css content
  // (title, favicon, meta, and css are tracked separately in breakdown)
  // Head structure: <head>\n<meta charset="utf-8">\n[title][optional \n favicon][optional \n meta][optional \n css]\n</head>
  const headStructureBytes =
    measureBytes('<head>\n<meta charset="utf-8">\n') +
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
    content: contentHtml,
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
  posts?: Post[]
): string {
  if (block.type === 'bloglist') {
    return renderBloglist(posts || [], block as BloglistBlock);
  }

  if (block.type === 'divider') {
    return '<hr>';
  }

  if (block.type === 'codeblock') {
    return `<pre><code>${escapeHtml(block.content)}</code></pre>`;
  }

  if (block.type === 'unordered-list' || block.type === 'ordered-list') {
    const tag = block.type === 'unordered-list' ? 'ul' : 'ol';
    const items = block.items
      .map((item) => {
        const inlineHtml = flattenInlineNodes(item.children, icons, 'content');
        return `<li>${inlineHtml}</li>`;
      })
      .join('\n');
    return `<${tag}>\n${items}\n</${tag}>`;
  }

  const inlineHtml = flattenInlineNodes(block.children, icons, 'content');

  if (block.type === 'heading') {
    const level = block.level ?? 1;
    return `<h${level}>${inlineHtml}</h${level}>`;
  }

  if (block.type === 'blockquote') {
    return `<blockquote>${inlineHtml}</blockquote>`;
  }

  return `<p>${inlineHtml}</p>`;
}

/** Default limit for bloglist if not specified */
const DEFAULT_BLOGLIST_LIMIT = 20;

/**
 * Render a bloglist from post metadata (legacy, single block).
 * Used when bloglist doesn't need pagination.
 */
function renderBloglist(posts: Post[], block?: BloglistBlock): string {
  const published = posts.filter(p => p.status === 'published' && p.pageType === 'post');

  if (published.length === 0) {
    return '<p class="empty">Noch keine Posts.</p>';
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
    return `<li class="post"><a href="/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a> - <time datetime="${escapeHtml(post.publishedAt)}">${date}</time></li>`;
  }).join('\n');

  let html = `<ul class="posts">\n${items}\n</ul>`;

  // Add archive link if configured
  if (block?.archiveLink) {
    html += `\n<p class="archive-link"><a href="${escapeHtml(block.archiveLink.href)}">${escapeHtml(block.archiveLink.text)}</a></p>`;
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
  sourceIndex: number
): FlattenedContentBlock[] {
  const published = posts.filter(p => p.status === 'published' && p.pageType === 'post');

  if (published.length === 0) {
    // Return empty message as a single block
    const html = '<p class="empty">Noch keine Posts.</p>';
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
    const html = `<li class="post"><a href="/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a> - <time datetime="${escapeHtml(post.publishedAt)}">${date}</time></li>`;
    return {
      html,
      bytes: measureBytes(html),
      sourceIndex,
      blockType: 'bloglist-item' as const,
    };
  });

  // Add archive link as separate block if configured
  if (block?.archiveLink) {
    const archiveHtml = `<p class="archive-link"><a href="${escapeHtml(block.archiveLink.href)}">${escapeHtml(block.archiveLink.text)}</a></p>`;
    blocks.push({
      html: archiveHtml,
      bytes: measureBytes(archiveHtml),
      sourceIndex,
      blockType: 'bloglist-archive-link' as const,
    });
  } else if (block?.limit === null) {
    // For full lists (archive page) with no archive link, add "End of list" marker
    const endHtml = '<p class="end-of-list">— Ende der Liste —</p>';
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

  if (page.content) {
    parts.push(page.content);
  }

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

  if (contentHtml) {
    parts.push(contentHtml);
  }

  if (paginationHtml) {
    parts.push(paginationHtml);
  }

  if (page.footer) {
    parts.push(page.footer);
  }

  parts.push(page.bodyClose, page.htmlClose);

  return normalizeLineEndings(parts.join('\n'));
}

