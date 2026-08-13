import { clampToBytes } from './clampToBytes.ts';
import { cleanTranscript } from './transcript.ts';

/**
 * How many lines of the closing block an excerpt keeps.
 *
 * A backstop rather than the rule: a tool that emits no blank line at all has one block the size of its whole
 * transcript, and without the cap the flattened line would lead with the run's banner. With it, that case
 * degrades to exactly a tail of this many lines.
 */
const MAX_BLOCK_LINES = 8;

/**
 * The bound on the line this returns, and so on what a caller persists beside a recorded pass.
 *
 * The line cap bounds how many lines the reduction keeps, not how long one of them is: a tool whose closing
 * block is a single long line -- a one-line JSON report, a wide table the whitespace fold collapses -- would
 * otherwise carry the whole retained tail into whatever stores it, to show at most a verdict line's worth.
 * Generous enough to leave every summary measured here untouched.
 */
const MAX_EXCERPT_BYTES = 2_048;

/** A character no horizontal rule is drawn from, so a line holding one is carrying content. */
const NON_RULE_CHARACTER = /[^-=_~*+.|:#]/u;

/**
 * Reduces a transcript to the one line a verdict's detail slot carries, or `undefined` when it held nothing.
 *
 * The excerpt is the last blank-line-delimited block: a tool that prints progress separates its closing
 * statement with a blank line, so the blank line is the tool naming where its summary starts. A fixed count of
 * trailing lines fits vitest's four-line summary and v8's six-line coverage summary only by coincidence.
 *
 * The line carries a byte bound of its own, so what a caller persists is bounded. The 512-byte ceiling a
 * verdict line is held to is not applied here, which leaves that line's grammar with the module that owns it.
 */
export function deriveExcerpt(transcript: string): string | undefined {
  const lines = cleanTranscript(transcript).split('\n');

  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1])) {
    end--;
  }

  let start = end;
  while (start > 0 && !isBlank(lines[start - 1])) {
    start--;
  }

  const excerpt = lines
    .slice(Math.max(start, end - MAX_BLOCK_LINES), end)
    // A rule exists for vertical layout and carries nothing once the block is flattened onto one line.
    .filter((line) => !isRuleOnly(line))
    .join(' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();

  return excerpt === '' ? undefined : clampToBytes(excerpt, MAX_EXCERPT_BYTES);
}

// region | Helpers

/** Reports whether a line holds nothing but whitespace, which is what delimits one block from the next. */
function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === '';
}

/**
 * Reports whether every one of a line's non-whitespace characters comes from the rule set, which separates a
 * table's horizontal rule from a heading such as `=== Coverage summary ===` and from a row carrying digits.
 */
function isRuleOnly(line: string): boolean {
  const content = line.replaceAll(/\s/gu, '');

  return content !== '' && !NON_RULE_CHARACTER.test(content);
}

// endregion | Helpers
