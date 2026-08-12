/**
 * How many lines of the closing block an excerpt keeps.
 *
 * A backstop rather than the rule: a tool that emits no blank line at all has one block the size of its whole
 * transcript, and without the cap the flattened line would lead with the run's banner. With it, that case
 * degrades to exactly a tail of this many lines.
 */
const MAX_BLOCK_LINES = 8;

/**
 * Matches the escape sequences a command writes when it colors output it is not sending to a terminal: a
 * control sequence, and an operating-system command such as the one a hyperlink is wrapped in.
 */
// eslint-disable-next-line no-control-regex -- an escape sequence is defined by the control characters composing it.
const ANSI_PATTERN = /\u{1B}(?:\[[\d;?]*[\u{20}-\u{2F}]*[\u{40}-\u{7E}]|\][^\u{7}\u{1B}]*(?:\u{7}|\u{1B}\\))/gu;

/** A character no horizontal rule is drawn from, so a line holding one is carrying content. */
const NON_RULE_CHARACTER = /[^-=_~*+.|:#]/u;

/**
 * Reduces a transcript to the one line a verdict's detail slot carries, or `undefined` when it held nothing.
 *
 * The excerpt is the last blank-line-delimited block: a tool that prints progress separates its closing
 * statement with a blank line, so the blank line is the tool naming where its summary starts. A fixed count of
 * trailing lines fits vitest's four-line summary and v8's six-line coverage summary only by coincidence.
 *
 * The 512-byte ceiling a verdict line is held to is not applied here, which leaves the line's grammar and its
 * clamp with the module that owns them.
 */
export function deriveExcerpt(transcript: string): string | undefined {
  const lines = transcript.replaceAll(ANSI_PATTERN, '').split(/\r?\n/u);

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

  return excerpt === '' ? undefined : excerpt;
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
