import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_BREAKING_POLICIES, DEFAULT_WORK_TYPES } from '../defaults.ts';
import { parseCommitMessage, type PolicyViolationHandler } from '../parseCommitMessage.ts';
import type { Commit } from '../types.ts';

describe('parseCommitMessage `!` policy enforcement', () => {
  it('accepts both bare and `!` forms for `optional` policy types (feat, sec)', () => {
    const featBare = parseCommitMessage('feat: add thing', 'p1', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(featBare?.breaking).toBe(false);

    const featBang = parseCommitMessage('feat!: add thing', 'p2', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(featBang?.breaking).toBe(true);

    const featureBang = parseCommitMessage('feature!: add thing', 'p3', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(featureBang?.type).toBe('feat');
    expect(featureBang?.breaking).toBe(true);

    const secBare = parseCommitMessage('sec: patch CVE', 'p4', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(secBare?.breaking).toBe(false);

    const secBang = parseCommitMessage('sec!: patch CVE', 'p5', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(secBang?.breaking).toBe(true);

    const securityBang = parseCommitMessage('security!: patch CVE', 'p6', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(securityBang?.type).toBe('sec');
    expect(securityBang?.breaking).toBe(true);
  });

  it('accepts bare `drop:` without a policy violation, and `drop!` and `drop(scope)!` as breaking', () => {
    const onPolicyViolation = vi.fn<PolicyViolationHandler>();

    const dropBare = parseCommitMessage('drop: remove API', 'p7', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(dropBare?.type).toBe('drop');
    expect(dropBare?.breaking).toBe(false);
    expect(onPolicyViolation).not.toHaveBeenCalled();

    const dropBang = parseCommitMessage('drop!: remove API', 'p8', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(dropBang?.breaking).toBe(true);
    expect(onPolicyViolation).not.toHaveBeenCalled();

    const dropScopedBang = parseCommitMessage('drop(api)!: remove endpoint', 'p9', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(dropScopedBang?.type).toBe('drop');
    expect(dropScopedBang?.scope).toBe('api');
    expect(dropScopedBang?.breaking).toBe(true);
  });

  it('accepts `internal:` and `utility:` (alias) and resolves both to `internal`', () => {
    const internalBare = parseCommitMessage('internal: refactor helper', 'p10', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(internalBare?.type).toBe('internal');
    expect(internalBare?.breaking).toBe(false);

    const utilityBare = parseCommitMessage('utility: refactor helper', 'p11', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(utilityBare?.type).toBe('internal');
    expect(utilityBare?.breaking).toBe(false);
  });

  it('treats `internal!` and `utility!` as policy violations; parses with breaking: false', () => {
    const onPolicyViolation = vi.fn<PolicyViolationHandler>();

    const internalBang = parseCommitMessage('internal!: refactor helper', 'p12', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(internalBang?.type).toBe('internal');
    expect(internalBang?.breaking).toBe(false);
    expect(onPolicyViolation).toHaveBeenCalledWith(
      expectedCommit('internal!: refactor helper', 'p12'),
      'internal',
      'prefix',
    );

    onPolicyViolation.mockClear();
    const utilityBang = parseCommitMessage('utility!: refactor helper', 'p13', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(utilityBang?.type).toBe('internal');
    expect(utilityBang?.breaking).toBe(false);
    expect(onPolicyViolation).toHaveBeenCalledWith(
      expectedCommit('utility!: refactor helper', 'p13'),
      'internal',
      'prefix',
    );
  });

  it.each([
    ['fix!', 'fix'],
    ['bugfix!', 'fix'],
    ['perf!', 'perf'],
    ['performance!', 'perf'],
  ])('accepts `%s` as a compliant breaking commit under the optional policy', (prefix, canonicalType) => {
    const onPolicyViolation = vi.fn<PolicyViolationHandler>();
    const result = parseCommitMessage(`${prefix}: change a contract`, 'h', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(result?.type).toBe(canonicalType);
    expect(result?.breaking).toBe(true);
    expect(onPolicyViolation).not.toHaveBeenCalled();
  });

  it.each([
    ['deps!', 'deps'],
    ['tests!', 'tests'],
    ['tooling!', 'tooling'],
    ['ci!', 'ci'],
    ['ai!', 'ai'],
    ['docs!', 'docs'],
    ['fmt!', 'fmt'],
    ['refactor!', 'refactor'],
    ['deprecate!', 'deprecate'],
  ])('treats `%s` as a forbidden-policy violation and parses with breaking: false', (prefix, canonicalType) => {
    const onPolicyViolation = vi.fn<PolicyViolationHandler>();
    const message = `${prefix}: do something`;
    const result = parseCommitMessage(message, 'h', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(result?.type).toBe(canonicalType);
    expect(result?.breaking).toBe(false);
    expect(onPolicyViolation).toHaveBeenCalledWith(expectedCommit(message, 'h'), canonicalType, 'prefix');
  });

  it('accepts `BREAKING CHANGE:` body footer on an optional-policy type as a valid breaking signal', () => {
    const onPolicyViolation = vi.fn<PolicyViolationHandler>();
    const message = 'feat: new API\n\nBREAKING CHANGE: removes old path';
    const result = parseCommitMessage(message, 'p19', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(result?.type).toBe('feat');
    expect(result?.breaking).toBe(true);
    expect(onPolicyViolation).not.toHaveBeenCalled();
  });

  it('treats `BREAKING CHANGE:` body footer on a forbidden-policy type as a policy violation with breaking: false', () => {
    const onPolicyViolation = vi.fn<PolicyViolationHandler>();
    const message = 'refactor: extract parser\n\nBREAKING CHANGE: removes deprecated path';
    const result = parseCommitMessage(message, 'p14', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(result?.type).toBe('refactor');
    expect(result?.breaking).toBe(false);
    expect(onPolicyViolation).toHaveBeenCalledWith(expectedCommit(message, 'p14'), 'refactor', 'body');
  });

  it('reports both prefix and body surfaces independently when both are present on a forbidden type', () => {
    const onPolicyViolation = vi.fn<PolicyViolationHandler>();
    const message = 'refactor!: extract parser\n\nBREAKING CHANGE: removes deprecated path';
    const result = parseCommitMessage(message, 'p15', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(result?.breaking).toBe(false);
    expect(onPolicyViolation).toHaveBeenCalledTimes(2);
    expect(onPolicyViolation).toHaveBeenCalledWith(expectedCommit(message, 'p15'), 'refactor', 'prefix');
    expect(onPolicyViolation).toHaveBeenCalledWith(expectedCommit(message, 'p15'), 'refactor', 'body');
  });

  it('does not invoke the policy callback for compliant commits', () => {
    const onPolicyViolation = vi.fn<PolicyViolationHandler>();

    parseCommitMessage('feat!: add thing', 'p16', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    parseCommitMessage('drop!: remove old API', 'p17', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    parseCommitMessage('fix: patch bug', 'p18', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });

    expect(onPolicyViolation).not.toHaveBeenCalled();
  });
});

// region | Helpers
/** Builds the `Commit` that the parser passes to the policy callback, whose subject is the message's first line. */
function expectedCommit(message: string, hash: string): Commit {
  return { message, subject: message.split('\n', 1)[0] ?? '', hash };
}
// endregion | Helpers
