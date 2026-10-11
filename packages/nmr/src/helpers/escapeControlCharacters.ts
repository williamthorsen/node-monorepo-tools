/**
 * The control characters that `escapeControlCharacters` renders as escapes, each paired with the escape that a
 * JSON string uses for it. `\n` and `\r` break a diagnostic across lines; `\t` is the other one that a script value
 * realistically contains.
 */
const NAMED_ESCAPES = new Map([
  ['\n', String.raw`\n`],
  ['\r', String.raw`\r`],
  ['\t', String.raw`\t`],
]);

/**
 * Renders a declaration's text as the file stores it, so that a value written across lines is quoted on one line.
 *
 * A diagnostic names a declaration that the reader has to edit, and a JSON string contains an escape sequence where
 * a shell would read a control character. The rendered escape keeps the diagnostic on one line, and it is the text
 * for which the reader will search the file.
 *
 * Apply it only where the text is quoted: A comparison against the declaration reads the unescaped text.
 */
export function escapeControlCharacters(text: string): string {
  let escapedText = text;
  for (const [char, escape] of NAMED_ESCAPES) {
    escapedText = escapedText.split(char).join(escape);
  }

  return escapedText;
}
