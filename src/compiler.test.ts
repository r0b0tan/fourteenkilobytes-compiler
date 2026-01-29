/**
 * Compiler Tests
 *
 * Tests for core compiler functionality.
 * Uses Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CompilerInput, ContentBlock } from './types.js';
import { SIZE_LIMIT } from './types.js';
import { compile, dryRun, verifyDeterminism } from './compiler.js';
import { measureBytes } from './measure.js';
import { validateInput } from './validate.js';

/**
 * Create minimal valid input.
 */
function createMinimalInput(overrides: Partial<CompilerInput> = {}): CompilerInput {
  return {
    slug: 'test',
    title: 'Test Page',
    content: [
      {
        type: 'paragraph',
        children: [{ type: 'text', text: 'Hello, world!' }],
      },
    ],
    navigation: null,
    footer: null,
    css: null,
    meta: null,
    favicon: null,
    icons: [],
    allowPagination: false,
    buildId: 'test-build-001',
    ...overrides,
  };
}

/**
 * Create content blocks of specified total size.
 */
function createContentOfSize(targetBytes: number): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let currentBytes = 0;

  while (currentBytes < targetBytes) {
    const remaining = targetBytes - currentBytes;
    // Each paragraph adds <p></p> overhead (7 bytes) plus newline between blocks
    const textLength = Math.min(remaining - 7, 500);
    if (textLength <= 0) break;

    const text = 'x'.repeat(textLength);
    blocks.push({
      type: 'paragraph',
      children: [{ type: 'text', text }],
    });

    currentBytes += measureBytes(`<p>${text}</p>`) + (blocks.length > 1 ? 1 : 0);
  }

  return blocks;
}

describe('measureBytes', () => {
  it('measures ASCII correctly', () => {
    assert.equal(measureBytes('hello'), 5);
    assert.equal(measureBytes(''), 0);
    assert.equal(measureBytes(' '), 1);
  });

  it('measures multi-byte characters correctly', () => {
    assert.equal(measureBytes('é'), 2); // 2-byte UTF-8
    assert.equal(measureBytes('→'), 3); // 3-byte UTF-8
    assert.equal(measureBytes('𝕳'), 4); // 4-byte UTF-8
  });

  it('measures HTML entities in encoded form', () => {
    assert.equal(measureBytes('&amp;'), 5);
    assert.equal(measureBytes('&lt;'), 4);
    assert.equal(measureBytes('&gt;'), 4);
  });
});

describe('validateInput', () => {
  it('accepts valid input', () => {
    const input = createMinimalInput();
    const result = validateInput(input);
    assert.equal(result.valid, true);
  });

  it('rejects invalid slug', () => {
    const input = createMinimalInput({ slug: 'INVALID' });
    const result = validateInput(input);
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.equal(result.error.code, 'INVALID_SLUG');
    }
  });

  it('rejects empty title', () => {
    const input = createMinimalInput({ title: '' });
    const result = validateInput(input);
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.equal(result.error.code, 'EMPTY_TITLE');
    }
  });

  it('rejects unknown icon', () => {
    const input = createMinimalInput({
      icons: [{ id: 'unknown-icon', placement: 'content', index: 0 }],
    });
    const result = validateInput(input);
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.equal(result.error.code, 'ICON_NOT_IN_WHITELIST');
    }
  });

  it('accepts valid icon', () => {
    const input = createMinimalInput({
      icons: [{ id: 'arrow-right', placement: 'content', index: 0 }],
    });
    const result = validateInput(input);
    assert.equal(result.valid, true);
  });

  it('rejects invalid CSS', () => {
    const input = createMinimalInput({
      css: { rules: 'body { color: red' }, // Missing closing brace
    });
    const result = validateInput(input);
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.equal(result.error.code, 'CSS_PARSE_ERROR');
    }
  });
});

describe('compile', () => {
  it('compiles minimal input successfully', () => {
    const input = createMinimalInput();
    const result = compile(input);

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.pages.length, 1);
      assert.equal(result.pages[0].slug, 'test');
      assert.ok(result.pages[0].bytes <= SIZE_LIMIT);
    }
  });

  it('includes all structural elements', () => {
    const input = createMinimalInput();
    const result = compile(input);

    assert.equal(result.success, true);
    if (result.success) {
      const html = result.pages[0].html;
      assert.ok(html.includes('<!DOCTYPE html>'));
      assert.ok(html.includes('<html lang="en">'));
      assert.ok(html.includes('<head>'));
      assert.ok(html.includes('<meta charset="utf-8">'));
      assert.ok(html.includes('<title>Test Page</title>'));
      assert.ok(html.includes('</head>'));
      assert.ok(html.includes('<body>'));
      assert.ok(html.includes('<p>Hello, world!</p>'));
      assert.ok(html.includes('</body>'));
      assert.ok(html.includes('</html>'));
    }
  });

  it('includes navigation when provided', () => {
    const input = createMinimalInput({
      navigation: {
        items: [
          { text: 'Home', href: '/index.html' },
          { text: 'About', href: '/about.html' },
        ],
      },
    });
    const result = compile(input);

    assert.equal(result.success, true);
    if (result.success) {
      const html = result.pages[0].html;
      assert.ok(html.includes('<nav>'));
      assert.ok(html.includes('<a href="/index.html">Home</a>'));
      assert.ok(html.includes('<a href="/about.html">About</a>'));
      assert.ok(html.includes('</nav>'));
    }
  });

  it('includes footer when provided', () => {
    const input = createMinimalInput({
      footer: { content: 'Copyright 2024' },
    });
    const result = compile(input);

    assert.equal(result.success, true);
    if (result.success) {
      const html = result.pages[0].html;
      assert.ok(html.includes('<footer>Copyright 2024</footer>'));
    }
  });

  it('inlines CSS when provided', () => {
    const input = createMinimalInput({
      css: { rules: 'body{margin:0}' },
    });
    const result = compile(input);

    assert.equal(result.success, true);
    if (result.success) {
      const html = result.pages[0].html;
      assert.ok(html.includes('<style>body{margin:0}</style>'));
    }
  });

  it('fails when exceeding size limit without pagination', () => {
    const largeContent = createContentOfSize(SIZE_LIMIT + 1000);
    const input = createMinimalInput({
      content: largeContent,
      allowPagination: false,
    });
    const result = compile(input);

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, 'SIZE_LIMIT_EXCEEDED');
    }
  });

  it('paginates when exceeding size limit with pagination allowed', () => {
    const largeContent = createContentOfSize(SIZE_LIMIT + 5000);
    const input = createMinimalInput({
      content: largeContent,
      allowPagination: true,
    });
    const result = compile(input);

    assert.equal(result.success, true);
    if (result.success) {
      assert.ok(result.pages.length > 1);
      for (const page of result.pages) {
        assert.ok(page.bytes <= SIZE_LIMIT);
      }
    }
  });

  it('provides accurate byte measurements', () => {
    const input = createMinimalInput();
    const result = compile(input);

    assert.equal(result.success, true);
    if (result.success) {
      const page = result.pages[0];
      const actualBytes = measureBytes(page.html);
      assert.equal(page.bytes, actualBytes);
    }
  });

  it('provides breakdown that sums to total', () => {
    const input = createMinimalInput({
      navigation: { items: [{ text: 'Home', href: '/index.html' }] },
      footer: { content: 'Footer' },
      css: { rules: 'body{margin:0}' },
    });
    const result = compile(input);

    assert.equal(result.success, true);
    if (result.success) {
      const measurement = result.measurements[0];
      const breakdown = measurement.breakdown;
      const summed =
        breakdown.base +
        breakdown.title +
        breakdown.css +
        breakdown.navigation +
        breakdown.footer +
        breakdown.pagination +
        breakdown.icons +
        breakdown.content;

      // Allow small variance due to newline handling
      assert.ok(Math.abs(summed - measurement.total) <= 10);
    }
  });

  it('escapes HTML in content', () => {
    const input = createMinimalInput({
      content: [
        {
          type: 'paragraph',
          children: [{ type: 'text', text: '<script>alert("xss")</script>' }],
        },
      ],
    });
    const result = compile(input);

    assert.equal(result.success, true);
    if (result.success) {
      const html = result.pages[0].html;
      assert.ok(!html.includes('<script>'));
      assert.ok(html.includes('&lt;script&gt;'));
    }
  });
});

describe('dryRun', () => {
  it('returns same measurements as compile', () => {
    const input = createMinimalInput();
    const compileResult = compile(input);
    const dryRunResult = dryRun(input);

    assert.equal(compileResult.success, true);
    assert.equal(dryRunResult.wouldSucceed, true);

    if (compileResult.success && dryRunResult.wouldSucceed) {
      assert.equal(
        compileResult.measurements[0].total,
        dryRunResult.measurements[0].total
      );
    }
  });

  it('predicts failure correctly', () => {
    const largeContent = createContentOfSize(SIZE_LIMIT + 1000);
    const input = createMinimalInput({
      content: largeContent,
      allowPagination: false,
    });
    const result = dryRun(input);

    assert.equal(result.wouldSucceed, false);
    if (!result.wouldSucceed) {
      assert.equal(result.error.code, 'SIZE_LIMIT_EXCEEDED');
    }
  });
});

describe('verifyDeterminism', () => {
  it('produces identical output for identical input', () => {
    const input = createMinimalInput();
    assert.equal(verifyDeterminism(input), true);
  });

  it('produces identical output with all modules', () => {
    const input = createMinimalInput({
      navigation: { items: [{ text: 'Home', href: '/index.html' }] },
      footer: { content: 'Footer' },
      css: { rules: 'body{margin:0}' },
      icons: [{ id: 'arrow-right', placement: 'navigation', index: 0 }],
    });
    assert.equal(verifyDeterminism(input), true);
  });

  it('produces identical output with pagination', () => {
    const largeContent = createContentOfSize(SIZE_LIMIT + 5000);
    const input = createMinimalInput({
      content: largeContent,
      allowPagination: true,
    });
    assert.equal(verifyDeterminism(input), true);
  });
});

describe('inline formatting', () => {
  it('renders bold text', () => {
    const input = createMinimalInput({
      content: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'Hello ' },
            { type: 'bold', children: [{ type: 'text', text: 'world' }] },
          ],
        },
      ],
    });
    const result = compile(input);

    assert.equal(result.success, true);
    if (result.success) {
      assert.ok(result.pages[0].html.includes('<b>world</b>'));
    }
  });

  it('renders italic text', () => {
    const input = createMinimalInput({
      content: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'Hello ' },
            { type: 'italic', children: [{ type: 'text', text: 'world' }] },
          ],
        },
      ],
    });
    const result = compile(input);

    assert.equal(result.success, true);
    if (result.success) {
      assert.ok(result.pages[0].html.includes('<i>world</i>'));
    }
  });

  it('renders links', () => {
    const input = createMinimalInput({
      content: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              href: '/page.html',
              children: [{ type: 'text', text: 'Click here' }],
            },
          ],
        },
      ],
    });
    const result = compile(input);

    assert.equal(result.success, true);
    if (result.success) {
      assert.ok(result.pages[0].html.includes('<a href="/page.html">Click here</a>'));
    }
  });

  it('renders nested formatting', () => {
    const input = createMinimalInput({
      content: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'bold',
              children: [
                { type: 'italic', children: [{ type: 'text', text: 'nested' }] },
              ],
            },
          ],
        },
      ],
    });
    const result = compile(input);

    assert.equal(result.success, true);
    if (result.success) {
      assert.ok(result.pages[0].html.includes('<b><i>nested</i></b>'));
    }
  });
});

describe('headings', () => {
  it('renders all heading levels', () => {
    const input = createMinimalInput({
      content: [
        { type: 'heading', level: 1, children: [{ type: 'text', text: 'H1' }] },
        { type: 'heading', level: 2, children: [{ type: 'text', text: 'H2' }] },
        { type: 'heading', level: 3, children: [{ type: 'text', text: 'H3' }] },
        { type: 'heading', level: 4, children: [{ type: 'text', text: 'H4' }] },
        { type: 'heading', level: 5, children: [{ type: 'text', text: 'H5' }] },
        { type: 'heading', level: 6, children: [{ type: 'text', text: 'H6' }] },
      ],
    });
    const result = compile(input);

    assert.equal(result.success, true);
    if (result.success) {
      const html = result.pages[0].html;
      assert.ok(html.includes('<h1>H1</h1>'));
      assert.ok(html.includes('<h2>H2</h2>'));
      assert.ok(html.includes('<h3>H3</h3>'));
      assert.ok(html.includes('<h4>H4</h4>'));
      assert.ok(html.includes('<h5>H5</h5>'));
      assert.ok(html.includes('<h6>H6</h6>'));
    }
  });
});
