import { defineGlyphSet, STATUS_GLYPHS } from '@williamthorsen/nmr-core';
import { describe, expect, it } from 'vitest';

import { NMR_GLYPHS, type NmrGlyphName } from '../glyphs.ts';

/** Every name the set defines, so a case reaches each one rather than whichever it happens to spell. */
const GLYPH_NAMES = ['catalog', 'clean', 'noop', 'overrides', 'package', 'recording'] as const satisfies NmrGlyphName[];

/** The names whose glyph is followed by a word, which is what leaves their plain variant empty. */
const DECORATIVE_NAMES = ['catalog', 'clean', 'overrides', 'package', 'recording'] as const satisfies NmrGlyphName[];

describe('NMR_GLYPHS', () => {
  // `defineGlyphSet` throws on a rich variant that no terminal draws two cells wide, so this rebuild is what
  // holds a later edit to the same rule the module load already enforces.
  it('holds only variants that defineGlyphSet accepts', () => {
    const variants = Object.fromEntries(
      GLYPH_NAMES.map((name) => [name, { plain: NMR_GLYPHS.plain[name].text, rich: NMR_GLYPHS.rich[name].text }]),
    );

    expect(() => defineGlyphSet(variants)).not.toThrow();
  });

  it.each(DECORATIVE_NAMES)('leaves the plain %s empty, because a word follows the glyph', (name) => {
    expect(NMR_GLYPHS.plain[name].text).toBe('');
  });

  // A word rather than an empty variant: the glyph opens a verdict line whose next token is a scope name.
  it('spells the plain no-op as a word', () => {
    expect(NMR_GLYPHS.plain.noop.text).toBe('NOOP');
  });

  // What lets a verdict line spend no padding column on its marker.
  it('gives the no-op the width every plain verdict marker has', () => {
    const verdictMarkers = [
      STATUS_GLYPHS.plain.passed,
      STATUS_GLYPHS.plain.failed,
      STATUS_GLYPHS.plain.skipped,
      NMR_GLYPHS.plain.noop,
    ];

    expect(new Set(verdictMarkers.map((glyph) => glyph.width))).toStrictEqual(new Set([4]));
  });
});
