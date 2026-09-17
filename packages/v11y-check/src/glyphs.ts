import {
  defineGlyphSet,
  measureGlyphColumn,
  type OutputStyle,
  STATUS_GLYPHS,
  type StatusGlyphName,
} from '@williamthorsen/nmr-core';

/**
 * Glyphs that name no status; a status marker comes from nmr-core's `STATUS_GLYPHS`. A plain variant is empty
 * where a word always follows the glyph.
 */
export const V11Y_GLYPHS = defineGlyphSet({
  audit: { plain: '', rich: '\u{1F52C}' },
  scopeDev: { plain: '', rich: '\u{1F527}' },
  scopeProd: { plain: '', rich: '\u{1F4E6}' },
  severityHigh: { plain: '', rich: '\u{1F534}' },
  severityLow: { plain: '', rich: '\u{1F7E1}' },
  severityModerate: { plain: '', rich: '\u{1F7E0}' },
  stale: { plain: 'STALE', rich: '\u{1F9F9}' },
});

export type V11yGlyphName = keyof (typeof V11Y_GLYPHS)['rich'];

/** A glyph that opens a finding's row: a status, or the stale marker. */
export type RowMarkerName = StatusGlyphName | 'stale';

/** Renders a glyph and a message, omitting the separating space when the glyph's variant is empty. */
export function formatGlyphLine(style: OutputStyle, name: V11yGlyphName, message: string): string {
  const { text } = V11Y_GLYPHS[style][name];
  return text === '' ? message : `${text} ${message}`;
}

/** Renders a row marker and a message, padding the marker so that messages align across markers. */
export function formatMarkedLine(style: OutputStyle, name: RowMarkerName, message: string): string {
  const glyph = name === 'stale' ? V11Y_GLYPHS[style].stale : STATUS_GLYPHS[style][name];
  const padding = ' '.repeat(measureRowMarkerColumn(style) - glyph.width);
  return `${glyph.text}${padding} ${message}`;
}

/** Reports the cells taken by the widest row marker in a style. */
export function measureRowMarkerColumn(style: OutputStyle): number {
  return Math.max(measureGlyphColumn(STATUS_GLYPHS[style]), V11Y_GLYPHS[style].stale.width);
}
