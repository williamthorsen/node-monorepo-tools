import { assertTaggedBaseline } from './assertTaggedBaseline.ts';
import { collect, type CollectedReleases, type RunContext } from './prepareRunContext.ts';
import {
  buildSkippedTargetResult,
  decideTargetRelease,
  planTargetRelease,
  readTargetHistory,
} from './prepareTarget.ts';
import { PROJECT_TARGET_ID } from './resolveReleaseTargets.ts';
import type { CompositeTarget, ReleaseType, TargetPrepareResult } from './types.ts';

/**
 * Describes why a run narrowed by `only` skips a composite and how to include it, or returns `undefined` when the run
 * prepares it: every run that `only` doesn't narrow, and every one that names it. A `project` block's composite
 * cannot be named.
 */
export function describeCompositeSkip(
  compositeTarget: CompositeTarget,
  onlyNames: readonly string[] | undefined,
): string | undefined {
  if (onlyNames === undefined || onlyNames.includes(compositeTarget.id)) {
    return undefined;
  }
  if (compositeTarget.id === PROJECT_TARGET_ID) {
    return (
      `Project release skipped: --only narrows this run to ${onlyNames.join(', ')}. ` +
      'Run `release-kit prepare` without --only to include the project release.'
    );
  }
  return `Release '${compositeTarget.id}' skipped: --only does not name it. Add ${compositeTarget.id} to --only to include it.`;
}

/**
 * Prepares a composite target: reads its history, asserts its baseline, and decides and plans its release, appending
 * its tag, writes, and modified files to the run's collection and its preview warnings to `warnings`.
 */
export function prepareComposite(
  compositeTarget: CompositeTarget,
  context: RunContext,
  options: { shouldForce?: boolean; bumpOverride?: ReleaseType },
  collectedReleases: CollectedReleases,
  warnings: string[],
): TargetPrepareResult {
  const { history, untaggedBaseline } = readTargetHistory(compositeTarget, context.settings);
  assertTaggedBaseline([untaggedBaseline]);

  const decision = decideTargetRelease(compositeTarget, history, {
    shouldForce: options.shouldForce === true,
    bumpOverride: options.bumpOverride,
    setVersion: undefined,
  });
  if (decision.outcome === 'skip') {
    return buildSkippedTargetResult(compositeTarget, history, decision.skipReason);
  }
  if (decision.setVersion !== undefined) {
    throw new Error('A composite target cannot take --set-version');
  }

  const plannedRelease = planTargetRelease({
    ...context,
    target: compositeTarget,
    release: { releaseType: decision.releaseType },
    decision,
    history,
  });
  collect(collectedReleases, plannedRelease);
  warnings.push(...plannedRelease.warnings);
  return plannedRelease.result;
}
