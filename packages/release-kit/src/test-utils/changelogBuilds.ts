import type { buildChangelogEntries, ChangelogDiagnostics } from '../buildChangelogEntries.ts';
import type { ChangelogEntry } from '../types.ts';

/** Builds a `buildChangelogEntries` result, for a mocked builder to return; diagnostics default to none. */
export function makeChangelogBuild(
  entries: ChangelogEntry[],
  diagnostics: Partial<ChangelogDiagnostics> = {},
): ReturnType<typeof buildChangelogEntries> {
  return {
    entries,
    diagnostics: { malformedBlocks: [], policyViolations: [], undeclaredEntryTypes: [], ...diagnostics },
  };
}
