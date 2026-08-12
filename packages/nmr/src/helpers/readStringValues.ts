/**
 * Keeps the entries whose value is a string, dropping the rest.
 *
 * A manifest reader that rejected the whole record over one bad value would report nothing about the entries
 * beside it, which for a reporter is silence where there is something to say. YAML's implicit typing makes
 * that easy to reach without malformed intent: an unquoted `18` parses as a number.
 */
export function readStringValues(record: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}
