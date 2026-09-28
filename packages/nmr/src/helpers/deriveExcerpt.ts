import { clampToBytes } from './clampToBytes.ts';
import { cleanTranscript } from './transcript.ts';

/**
 * How many lines of the closing block an excerpt keeps.
 *
 * A backstop rather than the rule: a tool that never emits a blank line has one block the size of its whole
 * transcript, and without the cap the flattened line would lead with the run's banner. With it, that case
 * degrades to exactly a tail of this many lines.
 */
const MAX_BLOCK_LINES = 8;

/**
 * The bound on the line returned by `deriveExcerpt`, and therefore on what a caller persists beside a recorded pass.
 *
 * The line cap bounds how many lines the reduction keeps, not how long one of them is: a tool whose closing
 * block is a single long line -- a one-line JSON report, a wide table collapsed by the whitespace fold -- would
 * otherwise pass the whole retained tail to whatever stores it, to show at most a verdict line's worth.
 * Generous enough to leave every summary measured here untouched.
 */
const MAX_EXCERPT_BYTES = 2_048;

/** A character outside the set from which horizontal rules are drawn, so a line holding one contains content. */
const NON_RULE_CHARACTER = /[^-=_~*+.|:#]/u;

/**
 * Reduces a transcript to the one line shown in a verdict's detail slot, or `undefined` when it contained nothing.
 *
 * The excerpt is the last blank-line-delimited block: a tool that prints progress separates its closing
 * statement with a blank line, and that blank line is the tool's own mark of where its summary starts.
 *
 * The line is bounded by `MAX_EXCERPT_BYTES` alone; the ceiling on a verdict line is applied where that line is
 * composed.
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
    // A rule exists for vertical layout and conveys nothing once the block is flattened onto one line.
    .filter((line) => !isRuleOnly(line))
    .join(' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();

  return excerpt === '' ? undefined : clampToBytes(excerpt, MAX_EXCERPT_BYTES);
}

// region | Helpers

/** Reports whether a line contains nothing but whitespace, which is what delimits one block from the next. */
function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === '';
}

/**
 * Reports whether every one of a line's non-whitespace characters comes from the rule set, which separates a
 * table's horizontal rule from a heading such as `=== Coverage summary ===` and from a row containing digits.
 */
function isRuleOnly(line: string): boolean {
  const content = line.replaceAll(/\s/gu, '');

  return content !== '' && !NON_RULE_CHARACTER.test(content);
}

// endregion | Helpers
