import { defineGlyphSet, type OutputStyle } from '@williamthorsen/nmr-core';

/**
 * Glyphs that name no status; a status marker comes from nmr-core's `STATUS_GLYPHS`. A plain variant is empty
 * where a word always follows the glyph, and a word where the glyph opens a line of its own.
 *
 * `noop` is a neutral circle: nothing ran because the repo asked for nothing to run, which is neither a
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

/** Renders a glyph and a message, omitting the separating space when the glyph's variant is empty. */
export function formatGlyphLine(style: OutputStyle, name: NmrGlyphName, message: string): string {
  const { text } = NMR_GLYPHS[style][name];
  return text === '' ? message : `${text} ${message}`;
}
