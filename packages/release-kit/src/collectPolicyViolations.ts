import type { PolicyViolationHandler } from './parseCommitMessage.ts';
import type { PolicyViolation } from './types.ts';

/**
 * Build a fresh `policyViolations` accumulator paired with the `onPolicyViolation` callback
 * that pushes structured entries into it.
 *
 * Used by all three release-prepare orchestrators (`releasePrepare`, `releasePrepareMono`,
 * `releasePrepareProject`) to collect parser-side `!`-policy violations into a result-attachable
 * array. Centralizing the callback shape keeps the `commitSubject` extraction rule (`firstLine
 * post-split`) consistent across orchestrators.
 */
export function createPolicyViolationCollector(): {
  violations: PolicyViolation[];
  onPolicyViolation: PolicyViolationHandler;
} {
  const violations: PolicyViolation[] = [];
  const onPolicyViolation: PolicyViolationHandler = (commit, type, surface) => {
    violations.push({
      commitHash: commit.hash,
      commitSubject: commit.message.split('\n', 1)[0] ?? '',
      type,
      surface,
    });
  };
  return { violations, onPolicyViolation };
}
