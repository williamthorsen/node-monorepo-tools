import { defineGlyphSet } from '@williamthorsen/nmr-core';

/** Glyphs that name no status; a status marker comes from nmr-core's `STATUS_GLYPHS`. */
export const RELEASE_GLYPHS = defineGlyphSet({
  bump: { plain: 'BUMP', rich: '📦' },
  // The words "DRY RUN" follow this glyph, so the plain variant adds nothing.
  dryRun: { plain: '', rich: '🔍' },
  tag: { plain: 'TAG', rich: '🔖' },
});

export type ReleaseGlyphName = keyof (typeof RELEASE_GLYPHS)['rich'];
