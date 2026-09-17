import { defineGlyphSet, type OutputStyle } from '@williamthorsen/nmr-core';

/** Glyphs that name no status; a status marker comes from nmr-core's `STATUS_GLYPHS`. */
export const RELEASE_GLYPHS = defineGlyphSet({
  bump: { plain: 'BUMP', rich: '📦' },
  // The words "DRY RUN" follow this glyph, so the plain variant adds nothing.
  dryRun: { plain: '', rich: '🔍' },
  tag: { plain: 'TAG', rich: '🔖' },
});

export type ReleaseGlyphName = keyof (typeof RELEASE_GLYPHS)['rich'];

/** Renders a glyph and a message, omitting the separating space when the glyph's variant is empty. */
export function formatGlyphLine(style: OutputStyle, name: ReleaseGlyphName, message: string): string {
  const { text } = RELEASE_GLYPHS[style][name];
  return text === '' ? message : `${text} ${message}`;
}
