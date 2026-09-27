/** Splits a commit body into paragraphs on a run of blank lines, tolerating trailing whitespace on each. */
const PARAGRAPH_SEPARATOR = /\n(?:[ \t]*\n)+/;

/** Matches the literal `Migration:` label opening a paragraph, with the whitespace that follows it. */
const MIGRATION_LABEL = /^Migration:[ \t]*/;

/**
 * Extracts the instruction from a commit body's `Migration:` paragraph.
 *
 * The commit convention defines one literal `Migration:` label per body, so the first paragraph
 * opening with it wins and a second is ignored. The match is anchored and case-sensitive, so
 * `migration:` and `**Migration:**` yield nothing.
 *
 * Newlines inside the paragraph are preserved. The first character is capitalized, which repairs
 * an instruction that continues the label in lowercase. Returns `undefined` when no paragraph
 * opens with the label, or when the label is followed by nothing.
 */
export function extractMigration(body: string | undefined): string | undefined {
  if (body === undefined) {
    return undefined;
  }

  for (const paragraph of body.split(PARAGRAPH_SEPARATOR)) {
    if (!MIGRATION_LABEL.test(paragraph)) {
      continue;
    }
    const instruction = paragraph.replace(MIGRATION_LABEL, '').trim();
    if (instruction.length === 0) {
      return undefined;
    }
    return instruction.charAt(0).toUpperCase() + instruction.slice(1);
  }

  return undefined;
}
