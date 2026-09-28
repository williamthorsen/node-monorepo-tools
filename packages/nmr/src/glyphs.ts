import { defineGlyphSet } from '@williamthorsen/nmr-core';

/**
 * Glyphs that do not name a status; a status marker comes from nmr-core's `STATUS_GLYPHS`. A plain variant is
 * empty when a word always follows the glyph, and a word when the glyph opens a line of its own.
 *
 * `noop` is a neutral circle: Nothing ran because the repo asked for nothing to run, which is neither a
 * failure nor a block.
 */
export const NMR_GLYPHS = defineGlyphSet({
  catalog: { plain: '', rich: '\u{1F4DA}' },
  clean: { plain: '', rich: '\u{1F9F9}' },
  noop: { plain: 'NOOP', rich: '\u{26AA}' },
  overrides: { plain: '', rich: '\u{1F512}' },
  package: { plain: '', rich: '\u{1F4E6}' },
  recording: { plain: '', rich: '\u{1F4BE}' },
});

export type NmrGlyphName = keyof (typeof NMR_GLYPHS)['rich'];
