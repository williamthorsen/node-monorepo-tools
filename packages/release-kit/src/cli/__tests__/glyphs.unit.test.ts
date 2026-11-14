import { describe, expect, it } from 'vitest';

import { RELEASE_GLYPHS } from '../glyphs.ts';

describe('RELEASE_GLYPHS', () => {
  it('does not have a pictographic character in any plain variant', () => {
    const plainText = Object.values(RELEASE_GLYPHS.plain)
      .map((glyph) => glyph.text)
      .join('');

    expect(plainText).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
