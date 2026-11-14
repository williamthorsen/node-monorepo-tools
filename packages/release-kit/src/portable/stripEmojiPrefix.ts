/**
 * Matches a leading emoji and one space. The optional U+FE0F variation selector covers emojis such as `\u{1F5D1}️`
 * (wastebasket) and `\u{1F3D7}️` (building construction), whose canonical form includes it.
 */
const LEADING_EMOJI = /^\p{Extended_Pictographic}️? /u;

/** Removes a leading emoji and one space from a section title, returning the title unchanged when it has none. */
export function stripEmojiPrefix(value: string): string {
  return value.replace(LEADING_EMOJI, '');
}
