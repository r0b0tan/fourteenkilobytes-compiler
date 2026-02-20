import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from '../src/compiler.ts';
import { validateInput } from '../src/validate.ts';
import { SIZE_LIMIT } from '../src/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createInput(overrides = {}) {
  return {
    slug: 'constraint-test',
    title: 'Constraint Test',
    content: [
      {
        type: 'paragraph',
        children: [{ type: 'text', text: 'hello' }],
      },
    ],
    navigation: null,
    footer: null,
    css: null,
    meta: null,
    favicon: null,
    icons: [],
    allowPagination: false,
    buildId: 'build-constraint-001',
    ...overrides,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('Constraint engine invariants', () => {
  it('keeps every emitted page at or below byte limit when pagination is enabled', () => {
    const content = Array.from({ length: 220 }, (_, index) => ({
      type: 'paragraph',
      children: [{ type: 'text', text: `block-${index}-` + 'x'.repeat(120) }],
    }));

    const result = compile(createInput({ allowPagination: true, content }));
    expect(result.success).toBe(true);

    if (result.success) {
      for (const page of result.pages) {
        expect(page.bytes).toBeLessThanOrEqual(SIZE_LIMIT);
      }
    }
  });

  it('preserves all content markers after pagination split (no content loss)', () => {
    const markers = Array.from({ length: 160 }, (_, i) => `marker-${i}-fixed`);
    const content = markers.map((marker) => ({
      type: 'paragraph',
      children: [{ type: 'text', text: marker + ' ' + 'x'.repeat(140) }],
    }));

    const result = compile(createInput({ allowPagination: true, content }));
    expect(result.success).toBe(true);

    if (result.success) {
      const mergedHtml = result.pages.map((page) => page.html).join('\n');
      for (const marker of markers) {
        const occurrences = mergedHtml.split(marker).length - 1;
        expect(occurrences).toBe(1);
      }
    }
  });

  it('fails explicitly for a single section that exceeds available budget', () => {
    const oversizedSection = {
      type: 'section',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', text: 'y'.repeat(SIZE_LIMIT + 2000) }],
        },
      ],
    };

    const result = compile(createInput({ allowPagination: true, content: [oversizedSection] }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('PAGINATION_BLOCK_TOO_LARGE');
      expect(result.error.availableBudget).toBeGreaterThan(0);
      expect(result.error.blockSize).toBeGreaterThan(result.error.availableBudget);
    }
  });

  it('fails explicitly for empty content input', () => {
    const result = compile(createInput({ content: [] }));
    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.code).toBe('CONTENT_EMPTY');
    }
  });

  it('compiles assets-heavy page within constraints', () => {
    const input = createInput({
      content: [{ type: 'divider' }],
      navigation: { items: [{ text: 'Home', href: '/index.html' }] },
      footer: { content: 'Footer only assets mode' },
      css: { rules: '.a{margin:0}.b{padding:0}' },
      meta: { description: 'd', author: 'a' },
      favicon: 'data:image/svg+xml;base64,PHN2Zy8+',
      icons: [{ id: 'arrow-right', placement: 'navigation', index: 0 }],
    });

    const result = compile(input);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.pages.length).toBe(1);
      expect(result.pages[0].bytes).toBeLessThanOrEqual(SIZE_LIMIT);
    }
  });

  it('compiles text-only input and respects byte limit', () => {
    const content = Array.from({ length: 120 }, (_, index) => ({
      type: 'paragraph',
      children: [{ type: 'text', text: `txt-${index} ` + 'z'.repeat(180) }],
    }));

    const result = compile(createInput({ allowPagination: true, content }));
    expect(result.success).toBe(true);

    if (result.success) {
      result.pages.forEach((page) => expect(page.bytes).toBeLessThanOrEqual(SIZE_LIMIT));
    }
  });
});

describe('Parser/validation behavior', () => {
  it('fails explicitly on malformed content structures', () => {
    const input = createInput({
      content: [
        {
          type: 'unordered-list',
          items: [{ children: 'not-an-array' }],
        },
      ],
    });

    const result = validateInput(input);
    expect(result.valid).toBe(false);

    if (!result.valid) {
      expect(result.error.code).toBe('CONTENT_INVALID_ELEMENT');
      expect(result.error.path).toContain('content[0].items[0]');
    }
  });

  it('fails explicitly on invalid slug format', () => {
    const result = validateInput(createInput({ slug: 'INVALID_SLUG' }));
    expect(result.valid).toBe(false);

    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_SLUG');
    }
  });

  it('does not mutate input objects during compile', () => {
    const original = createInput({
      content: [
        { type: 'section', align: 'mittig', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'a' }] }] },
      ],
    });
    const before = clone(original);

    compile(original);

    expect(original).toEqual(before);
  });

  it('does not mutate input objects during validation', () => {
    const original = createInput({
      content: [
        { type: 'paragraph', selector: '.foo.bar', children: [{ type: 'text', text: 'immutability' }] },
      ],
    });
    const before = clone(original);

    validateInput(original);

    expect(original).toEqual(before);
  });
});

describe('Architecture boundary constraints', () => {
  it('keeps byte engine free from IO dependencies', () => {
    const source = readFileSync(resolve(__dirname, '../src/measure.ts'), 'utf8');

    expect(source).not.toMatch(/from\s+['"]node:fs['"]/);
    expect(source).not.toMatch(/from\s+['"]node:http['"]/);
    expect(source).not.toMatch(/from\s+['"]node:https['"]/);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest/);
  });

  it('keeps compiler module independent from HTTP clients', () => {
    const source = readFileSync(resolve(__dirname, '../src/compiler.ts'), 'utf8');

    expect(source).not.toMatch(/from\s+['"]node:http['"]/);
    expect(source).not.toMatch(/from\s+['"]node:https['"]/);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest/);
  });

  it('keeps core domain modules free from randomness side effects', () => {
    const domainFiles = ['../src/measure.ts', '../src/paginate.ts', '../src/validate.ts'];

    for (const relativePath of domainFiles) {
      const source = readFileSync(resolve(__dirname, relativePath), 'utf8');
      expect(source).not.toMatch(/Math\.random\s*\(/);
    }
  });
});
