import type { CompositePrepareResult, PackagePrepareResult, PrepareResult } from '../types.ts';

/** Returns the composite result of a plan, or undefined when the run did not prepare a composite. */
export function selectCompositeResult(plan: Pick<PrepareResult, 'targets'>): CompositePrepareResult | undefined {
  return plan.targets.find((result) => result.kind === 'composite');
}

/** Returns the package results of a plan, in result order. */
export function selectPackageResults(plan: Pick<PrepareResult, 'targets'>): PackagePrepareResult[] {
  return plan.targets.filter((result) => result.kind === 'package');
}
