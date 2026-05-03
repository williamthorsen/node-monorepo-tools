/**
 * Remove a leading emoji + single space from a section title, if present.
 *
 * Returns the input unchanged when no emoji prefix is detected. Used to make section-title
 * matching emoji-tolerant: a consumer's bare-name `devOnlySections` override (e.g.
 * `'Internal'`) keeps matching the emoji-prefixed default title (`'\u{1F3D7}️ Internal'`)
 * without requiring the consumer to update their config.
 *
 * The regex tolerates an optional U+FE0F variation selector after the pictographic codepoint
 * — required for emojis like `\u{1F5D1}️` (wastebasket) and `\u{1F3D7}️` (building
 * construction) whose canonical form includes it.
 */
const LEADING_EMOJI = /^\p{Extended_Pictographic}️? /u;

export function stripEmojiPrefix(value: string): string {
  return value.replace(LEADING_EMOJI, '');
}
