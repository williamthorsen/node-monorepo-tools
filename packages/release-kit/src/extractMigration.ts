/** Splits a commit body into paragraphs on a blank line, tolerating trailing whitespace on the blank one. */
const PARAGRAPH_SEPARATOR = /\n[ \t]*\n/;

/** Matches the literal `Migration:` label opening a paragraph, with the whitespace that follows it. */
const MIGRATION_LABEL = /^Migration:[ \t]*/;

/**
 * Extracts the instruction from a commit body's `Migration:` paragraph.
 *
 * The first paragraph opening with the label wins: the lede doctrine specifies one labeled
 * paragraph per body, so a second is ignored rather than appended. The match is anchored and
 * case-sensitive, so `migration:` and `**Migration:**` yield nothing; the doctrine calls the
 * label literal, and tolerating variants would let the form drift.
 *
 * Newlines inside the paragraph are preserved. The first character is capitalized, which is
 * inert for the imperative the doctrine requires and repairs the lowercase continuation of a
 * paragraph written before it. Returns `undefined` when no paragraph carries the label, or when
 * the label is followed by nothing.
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
