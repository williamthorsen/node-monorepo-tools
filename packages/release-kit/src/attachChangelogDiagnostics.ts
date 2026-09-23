import type { ChangelogDiagnostics } from './buildChangelogEntries.ts';
import type { ReleasedWorkspaceResult } from './types.ts';

/** Attaches a history's diagnostics to a released or skipped result, omitting each empty list. */
export function attachChangelogDiagnostics(
  result: Pick<ReleasedWorkspaceResult, 'malformedBlocks' | 'policyViolations' | 'undeclaredEntryTypes'>,
  diagnostics: ChangelogDiagnostics,
): void {
  if (diagnostics.malformedBlocks.length > 0) {
    result.malformedBlocks = diagnostics.malformedBlocks;
  }
  if (diagnostics.undeclaredEntryTypes.length > 0) {
    result.undeclaredEntryTypes = diagnostics.undeclaredEntryTypes;
  }
  if (diagnostics.policyViolations.length > 0) {
    result.policyViolations = diagnostics.policyViolations;
  }
}
