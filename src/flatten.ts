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

  // Build head content
  const titleHtml = `<title>${escapeHtml(input.title)}</title>`;
  breakdown.title = measureBytes(titleHtml);

  let cssHtml = '';
  if (input.css !== null) {
    cssHtml = `<style>${input.css.rules}</style>`;
    breakdown.css = measureBytes(cssHtml);
  }

  const headContent = `<meta charset="utf-8">\n${titleHtml}${cssHtml ? '\n' + cssHtml : ''}`;
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
  const contentBlocks: FlattenedContentBlock[] = input.content.map(
    (block, index) => {
      const html = flattenContentBlock(block, input.icons, input.posts);
      return {
        html,
        bytes: measureBytes(html),
        sourceIndex: index,
      };
    }
  );

  // Calculate total content bytes
  const contentHtml = contentBlocks.map((b) => b.html).join('\n');
  breakdown.content = measureBytes(contentHtml);

  // Static structure
  const doctype = '<!DOCTYPE html>';
  const htmlOpen = '<html lang="en">';
  const bodyOpen = '<body>';
  const bodyClose = '</body>';
  const htmlClose = '</html>';

  // Base bytes: structure without modules
  breakdown.base =
    measureBytes(doctype) +
    measureBytes('\n') +
    measureBytes(htmlOpen) +
    measureBytes('\n') +
    measureBytes(head) +
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
    return renderBloglist(posts || []);
  }

  const inlineHtml = flattenInlineNodes(block.children, icons, 'content');

  if (block.type === 'heading') {
    const level = block.level ?? 1;
    return `<h${level}>${inlineHtml}</h${level}>`;
  }

  return `<p>${inlineHtml}</p>`;
}

/**
 * Render a bloglist from post metadata.
 */
function renderBloglist(posts: Post[]): string {
  const published = posts.filter(p => p.status === 'published' && p.pageType === 'post');
  
  if (published.length === 0) {
    return '<p class="empty">Noch keine Posts.</p>';
  }
  
  published.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  
  const items = published.map(post => {
    const date = new Date(post.publishedAt).toLocaleDateString('de-DE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    return `<li class="post"><a href="/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a><time datetime="${escapeHtml(post.publishedAt)}">${date}</time></li>`;
  }).join('\n');
  
  return `<ul class="posts">\n${items}\n</ul>`;
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

/**
 * Calculate fixed overhead (everything except content and pagination).
 */
export function calculateFixedOverhead(
  page: FlattenedPage,
  breakdown: ModuleBreakdown
): number {
  // Base structure + navigation + footer + css + title + icons
  // Content and pagination are variable
  return (
    breakdown.base +
    breakdown.title +
    breakdown.css +
    breakdown.navigation +
    breakdown.footer +
    breakdown.icons -
    breakdown.title // title is already in base via head
  );
}

/**
 * Recalculate breakdown for a subset of content blocks.
 */
export function recalculateBreakdown(
  baseBreakdown: ModuleBreakdown,
  contentBlocks: FlattenedContentBlock[],
  paginationBytes: number
): ModuleBreakdown {
  const contentHtml = contentBlocks.map((b) => b.html).join('\n');
  const contentBytes = measureBytes(contentHtml);

  return {
    ...baseBreakdown,
    content: contentBytes,
    pagination: paginationBytes,
  };
}
