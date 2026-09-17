import { describe, expect, it } from 'vitest';

import { formatGlyphLine, RELEASE_GLYPHS } from '../glyphs.ts';

describe('RELEASE_GLYPHS', () => {
  it('has no pictographic character in any plain variant', () => {
    const plainText = Object.values(RELEASE_GLYPHS.plain)
      .map((glyph) => glyph.text)
      .join('');

    expect(plainText).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe(formatGlyphLine, () => {
  it('separates a glyph from its message with one space', () => {
    expect(formatGlyphLine('rich', 'tag', 'v1.2.3')).toBe('🔖 v1.2.3');
    expect(formatGlyphLine('plain', 'tag', 'v1.2.3')).toBe('TAG v1.2.3');
  });

  it('omits the separating space when the variant is empty', () => {
    expect(formatGlyphLine('rich', 'dryRun', 'DRY RUN')).toBe('🔍 DRY RUN');
    expect(formatGlyphLine('plain', 'dryRun', 'DRY RUN')).toBe('DRY RUN');
  });
});
