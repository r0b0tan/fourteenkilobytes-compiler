import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';

import { measureBytes, createPageMeasurement, totalFromBreakdown } from '../src/measure.ts';
import { compile, verifyDeterminism } from '../src/compiler.ts';
import { SIZE_LIMIT } from '../src/types.ts';

function createInput(overrides = {}) {
  return {
    slug: 'deterministic-test',
    title: 'Deterministic Test',
    content: [
      {
        type: 'paragraph',
        children: [{ type: 'text', text: 'Hello deterministic compiler' }],
      },
    ],
    navigation: null,
    footer: null,
    css: null,
    meta: null,
    favicon: null,
    icons: [],
    allowPagination: false,
    buildId: 'build-fixed-001',
    ...overrides,
  };
}

describe('Byte Engine invariants', () => {
  it.each([
    { label: 'empty string', value: '', expected: 0 },
    { label: 'single ASCII byte', value: 'a', expected: 1 },
    { label: 'ASCII boundary 13,999', value: 'x'.repeat(13999), expected: 13999 },
    { label: 'ASCII boundary 14,000', value: 'x'.repeat(14000), expected: 14000 },
    { label: 'ASCII boundary 14,001', value: 'x'.repeat(14001), expected: 14001 },
    { label: 'umlaut ä', value: 'ä', expected: 2 },
    { label: 'euro sign', value: '€', expected: 3 },
    { label: 'emoji', value: '😀', expected: 4 },
    { label: 'mixed latin + umlaut + emoji', value: 'abcä😀', expected: 9 },
  ])('measures UTF-8 bytes correctly: $label', ({ value, expected }) => {
    const measured = measureBytes(value);
    expect(measured).toBe(expected);
  });

  it('never returns negative, NaN or non-finite values for random unicode strings', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const measured = measureBytes(value);
        expect(Number.isFinite(measured)).toBe(true);
        expect(Number.isNaN(measured)).toBe(false);
        expect(measured).toBeGreaterThanOrEqual(0);
      }),
      { seed: 20260215, numRuns: 80 }
    );
  });

  it('matches TextEncoder byte length for random unicode strings', () => {
    const encoder = new TextEncoder();

    fc.assert(
      fc.property(fc.string(), (value) => {
        const measured = measureBytes(value);
        const expected = encoder.encode(value).length;
        expect(measured).toBe(expected);
      }),
      { seed: 20260215, numRuns: 80 }
    );
  });

  it('keeps total invariant: summed module bytes equal parent total', () => {
    const breakdown = {
      base: 100,
      title: 20,
      favicon: 5,
      meta: 30,
      css: 40,
      navigation: 50,
      footer: 60,
      pagination: 10,
      icons: 12,
      content: 200,
    };

    const measurement = createPageMeasurement('sum-invariant', breakdown);
    const summed = totalFromBreakdown(breakdown);

    expect(measurement.total).toBe(summed);
    expect(measurement.measurements.total).toBe(summed);
  });

  it('reports limit violation in a deterministic and defined way', () => {
    const tooLargeText = 'x'.repeat(SIZE_LIMIT + 2000);
    const input = createInput({
      allowPagination: false,
      content: [{ type: 'paragraph', children: [{ type: 'text', text: tooLargeText }] }],
    });

    const first = compile(input);
    const second = compile(input);

    expect(first.success).toBe(false);
    expect(second.success).toBe(false);

    if (!first.success && !second.success) {
      expect(first.error.code).toBe('SIZE_LIMIT_EXCEEDED');
      expect(second.error.code).toBe('SIZE_LIMIT_EXCEEDED');
      expect(first.error.limit).toBe(SIZE_LIMIT);
      expect(second.error.limit).toBe(SIZE_LIMIT);
      expect(first.error.measured).toBe(second.error.measured);
    }
  });
});

describe('Determinism guarantees', () => {
  it('produces byte-identical HTML for identical input', () => {
    const input = createInput({
      content: [
        { type: 'heading', level: 2, children: [{ type: 'text', text: 'Stable Heading' }] },
        { type: 'paragraph', children: [{ type: 'text', text: 'Stable Body ä€😀' }] },
      ],
      css: { rules: '.layout { display: grid; }' },
      buildId: 'fixed-build-id',
    });

    const runA = compile(input);
    const runB = compile(input);

    expect(runA.success).toBe(true);
    expect(runB.success).toBe(true);

    if (runA.success && runB.success) {
      expect(runA.pages[0].html).toBe(runB.pages[0].html);
      expect(runA.pages[0].bytes).toBe(runB.pages[0].bytes);
    }
  });

  it('produces identical SHA-256 hashes for identical final HTML', () => {
    const input = createInput();
    const runA = compile(input);
    const runB = compile(input);

    expect(runA.success).toBe(true);
    expect(runB.success).toBe(true);

    if (runA.success && runB.success) {
      const hashA = createHash('sha256').update(runA.pages[0].html, 'utf8').digest('hex');
      const hashB = createHash('sha256').update(runB.pages[0].html, 'utf8').digest('hex');
      expect(hashA).toBe(hashB);
      expect(runA.pages[0].hash).toBe(runB.pages[0].hash);
      expect(runA.pages[0].hash).toBe(hashA);
    }
  });

  it('keeps deterministic verification true for stable input', () => {
    const input = createInput();
    expect(verifyDeterminism(input)).toBe(true);
  });

  it('matches golden master snapshot for final HTML output only', () => {
    const input = createInput({
      title: 'Golden Master',
      content: [
        { type: 'heading', level: 1, children: [{ type: 'text', text: 'Hello Snapshot' }] },
        { type: 'paragraph', children: [{ type: 'text', text: 'Snapshot body.' }] },
      ],
      navigation: { items: [{ text: 'Home', href: '/index.html' }] },
      footer: { content: 'Footer text' },
      css: { rules: 'body{margin:0}.layout{display:grid}' },
      buildId: 'golden-001',
    });

    const result = compile(input);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.pages[0].html).toMatchSnapshot();
    }
  });
});
