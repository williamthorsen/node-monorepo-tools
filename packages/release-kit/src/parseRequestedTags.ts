/**
 * Parses the comma-separated `--tags` flag value into a list of requested tag names.
 *
 * Empty segments (from `--tags=`, leading/trailing commas, or `--tags=,,`) are dropped. When the
 * resulting list is empty, returns `undefined`, which the caller treats as no filter, as when
 * `--tags` is omitted.
 */
export function parseRequestedTags(flagValue: string | undefined): string[] | undefined {
  if (flagValue === undefined) {
    return undefined;
  }
  const segments = flagValue.split(',').filter(Boolean);
  return segments.length === 0 ? undefined : segments;
}
