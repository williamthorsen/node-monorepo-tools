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
  composite: CompositeTarget,
  only: readonly string[] | undefined,
): string | undefined {
  if (only === undefined || only.includes(composite.id)) {
    return undefined;
  }
  if (composite.id === PROJECT_TARGET_ID) {
    return (
      `Project release skipped: --only narrows this run to ${only.join(', ')}. ` +
      'Run `release-kit prepare` without --only to include the project release.'
    );
  }
  return `Release '${composite.id}' skipped: --only does not name it. Add ${composite.id} to --only to include it.`;
}

/**
 * Prepares a composite target: reads its history, asserts its baseline, and decides and plans its release, appending
 * its tag, writes, and modified files to the run's collection and its preview warnings to `warnings`.
 */
export function prepareComposite(
  composite: CompositeTarget,
  context: RunContext,
  options: { force?: boolean; bumpOverride?: ReleaseType },
  collected: CollectedReleases,
  warnings: string[],
): TargetPrepareResult {
  const { history, untagged } = readTargetHistory(composite, context.settings);
  assertTaggedBaseline([untagged]);

  const decision = decideTargetRelease(composite, history, {
    force: options.force === true,
    bumpOverride: options.bumpOverride,
    setVersion: undefined,
  });
  if (decision.outcome === 'skip') {
    return buildSkippedTargetResult(composite, history, decision.skipReason);
  }
  if (decision.setVersion !== undefined) {
    throw new Error('A composite target cannot take --set-version');
  }

  const planned = planTargetRelease({
    ...context,
    target: composite,
    release: { releaseType: decision.releaseType },
    decision,
    history,
  });
  collect(collected, planned);
  warnings.push(...planned.warnings);
  return planned.result;
}
