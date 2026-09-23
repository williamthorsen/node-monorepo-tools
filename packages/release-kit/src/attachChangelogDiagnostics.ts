import type { ChangelogDiagnostics } from './buildChangelogEntries.ts';
import type { ReleasedWorkspaceResult } from './types.ts';

/**
 * Attaches a build's diagnostics to a released result, omitting each empty list and appending entry policy violations
 * to those that the bump side collected.
 */
export function attachChangelogDiagnostics(
  result: Pick<ReleasedWorkspaceResult, 'malformedBlocks' | 'policyViolations' | 'undeclaredEntryTypes'>,
  diagnostics: ChangelogDiagnostics | undefined,
): void {
  if (diagnostics === undefined) {
    return;
  }
  if (diagnostics.malformedBlocks.length > 0) {
    result.malformedBlocks = diagnostics.malformedBlocks;
  }
  if (diagnostics.undeclaredEntryTypes.length > 0) {
    result.undeclaredEntryTypes = diagnostics.undeclaredEntryTypes;
  }
  if (diagnostics.policyViolations.length > 0) {
    result.policyViolations = [...(result.policyViolations ?? []), ...diagnostics.policyViolations];
  }
}
