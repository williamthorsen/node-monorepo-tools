import { defineGlyphSet } from '@williamthorsen/nmr-core';

/** Glyphs that do not name a status; a status marker comes from nmr-core's `STATUS_GLYPHS`. */
export const RELEASE_GLYPHS = defineGlyphSet({
  bump: { plain: 'BUMP', rich: '📦' },
  // A file outcome's message (here, `unchanged`, `updated`) opens on a word, so the plain variant adds nothing.
  created: { plain: '', rich: '🆕' },
  // The words "DRY RUN" follow this glyph, so the plain variant adds nothing.
  dryRun: { plain: '', rich: '🔍' },
  tag: { plain: 'TAG', rich: '🔖' },
  unchanged: { plain: '', rich: '⚪' },
  updated: { plain: '', rich: '📝' },
});

export type ReleaseGlyphName = keyof (typeof RELEASE_GLYPHS)['rich'];
