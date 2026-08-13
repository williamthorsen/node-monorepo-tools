/** Marks a value that was cut, so a reader can tell a truncated one from a complete one. */
export const TRUNCATION_MARK = '…';

/**
 * Cuts a string that would overrun a byte budget, marking the cut. What comes back is at most `budgetBytes`
 * long, the mark included.
 *
 * Cuts between code points rather than between bytes, so a multi-byte character is never left in halves.
 * Graphemes are left unconsidered, which can separate an emoji from a modifier following it -- a cost paid
 * only at a budget no caller here comes near.
 *
 * A budget too small to hold the mark yields nothing at all, rather than a return that overruns what the
 * caller asked for.
 */
export function clampToBytes(value: string, budgetBytes: number): string {
  if (Buffer.byteLength(value) <= budgetBytes) {
    return value;
  }

  const budget = budgetBytes - Buffer.byteLength(TRUNCATION_MARK);
  if (budget < 0) {
    return '';
  }

  let kept = '';
  let bytes = 0;

  for (const character of value) {
    const size = Buffer.byteLength(character);
    if (bytes + size > budget) break;
    kept += character;
    bytes += size;
  }

  return `${kept}${TRUNCATION_MARK}`;
}
