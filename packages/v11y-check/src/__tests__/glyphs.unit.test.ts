import { describe, expect, it } from 'vitest';

import { formatMarkedLine, measureRowMarkerColumn, V11Y_GLYPHS } from '../glyphs.ts';

describe('V11Y_GLYPHS', () => {
  it('has no pictographic character in any plain variant', () => {
    const plainText = Object.values(V11Y_GLYPHS.plain)
      .map((glyph) => glyph.text)
      .join('');

    expect(plainText).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe(formatMarkedLine, () => {
  it('renders a status marker from the shared set', () => {
    expect(formatMarkedLine('rich', 'failed', 'GHSA-1')).toBe('\u{274C} GHSA-1');
    expect(formatMarkedLine('rich', 'passed', 'GHSA-1')).toBe('\u{2705} GHSA-1');
    expect(formatMarkedLine('rich', 'skipped', 'GHSA-1')).toBe('\u{23E9} GHSA-1');
  });

  it('renders the stale marker from the package set', () => {
    expect(formatMarkedLine('rich', 'stale', '1234')).toBe('\u{1F9F9} 1234');
  });

  it('pads a plain marker so that messages align across markers', () => {
    expect(formatMarkedLine('plain', 'failed', 'GHSA-1')).toBe('FAIL  GHSA-1');
    expect(formatMarkedLine('plain', 'stale', '1234')).toBe('STALE 1234');
  });
});

describe(measureRowMarkerColumn, () => {
  it('reports the widest row marker of each style', () => {
    expect(measureRowMarkerColumn('rich')).toBe(2);
    expect(measureRowMarkerColumn('plain')).toBe(5);
  });
});
