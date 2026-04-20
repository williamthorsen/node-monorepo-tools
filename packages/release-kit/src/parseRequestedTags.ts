/**
 * Parse the comma-separated `--tags` flag value into a list of requested tag names.
 *
 * Empty segments (from `--tags=`, leading/trailing commas, or `--tags=,,`) are dropped. When the
 * resulting list is empty, returns `undefined` so the caller treats it as "no filter" — the same
 * behavior as omitting `--tags` entirely.
 */
export function parseRequestedTags(flagValue: string | undefined): string[] | undefined {
  if (flagValue === undefined) {
    return undefined;
  }
  const segments = flagValue.split(',').filter(Boolean);
  return segments.length === 0 ? undefined : segments;
}
