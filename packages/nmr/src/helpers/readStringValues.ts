/**
 * Keeps the entries whose value is a string, dropping the rest.
 *
 * Drops rather than rejects, so that one malformed value does not hide the entries beside it. YAML's implicit
 * typing makes such a value easy to write: An unquoted `18` parses as a number.
 */
export function readStringValues(record: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}
