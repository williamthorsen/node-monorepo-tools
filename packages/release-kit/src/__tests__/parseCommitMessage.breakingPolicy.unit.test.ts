import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_BREAKING_POLICIES, DEFAULT_WORK_TYPES } from '../defaults.ts';
import { parseCommitMessage, type PolicyViolationHandler } from '../parseCommitMessage.ts';
import type { Commit } from '../types.ts';

describe('parseCommitMessage `!` policy enforcement', () => {
  it('accepts both bare and `!` forms for `optional` policy types (feat, sec)', () => {
    const featBareCommit = parseCommitMessage('feat: add thing', 'p1', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(featBareCommit?.breaking).toBe(false);

    const featBangCommit = parseCommitMessage('feat!: add thing', 'p2', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(featBangCommit?.breaking).toBe(true);

    const featureBangCommit = parseCommitMessage('feature!: add thing', 'p3', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(featureBangCommit?.type).toBe('feat');
    expect(featureBangCommit?.breaking).toBe(true);

    const secBareCommit = parseCommitMessage('sec: patch CVE', 'p4', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(secBareCommit?.breaking).toBe(false);

    const secBangCommit = parseCommitMessage('sec!: patch CVE', 'p5', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(secBangCommit?.breaking).toBe(true);

    const securityBangCommit = parseCommitMessage('security!: patch CVE', 'p6', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(securityBangCommit?.type).toBe('sec');
    expect(securityBangCommit?.breaking).toBe(true);
  });

  it('accepts bare `drop:` without a policy violation, and `drop!` and `drop(scope)!` as breaking', () => {
    const onPolicyViolation = vi.fn<PolicyViolationHandler>();

    const dropBareCommit = parseCommitMessage('drop: remove API', 'p7', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(dropBareCommit?.type).toBe('drop');
    expect(dropBareCommit?.breaking).toBe(false);
    expect(onPolicyViolation).not.toHaveBeenCalled();

    const dropBangCommit = parseCommitMessage('drop!: remove API', 'p8', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(dropBangCommit?.breaking).toBe(true);
    expect(onPolicyViolation).not.toHaveBeenCalled();

    const dropScopedBangCommit = parseCommitMessage(
      'drop(api)!: remove endpoint',
      'p9',
      DEFAULT_WORK_TYPES,
      undefined,
      {
        breakingPolicies: DEFAULT_BREAKING_POLICIES,
        onPolicyViolation,
      },
    );
    expect(dropScopedBangCommit?.type).toBe('drop');
    expect(dropScopedBangCommit?.scope).toBe('api');
    expect(dropScopedBangCommit?.breaking).toBe(true);
  });

  it('accepts `internal:` and `utility:` (alias) and resolves both to `internal`', () => {
    const internalBareCommit = parseCommitMessage('internal: refactor helper', 'p10', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(internalBareCommit?.type).toBe('internal');
    expect(internalBareCommit?.breaking).toBe(false);

    const utilityBareCommit = parseCommitMessage('utility: refactor helper', 'p11', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
    });
    expect(utilityBareCommit?.type).toBe('internal');
    expect(utilityBareCommit?.breaking).toBe(false);
  });

  it('treats `internal!` and `utility!` as policy violations; parses with breaking: false', () => {
    const onPolicyViolation = vi.fn<PolicyViolationHandler>();

    const internalBangCommit = parseCommitMessage('internal!: refactor helper', 'p12', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(internalBangCommit?.type).toBe('internal');
    expect(internalBangCommit?.breaking).toBe(false);
    expect(onPolicyViolation).toHaveBeenCalledWith(
      expectedCommit('internal!: refactor helper', 'p12'),
      'internal',
      'prefix',
    );

    onPolicyViolation.mockClear();
    const utilityBangCommit = parseCommitMessage('utility!: refactor helper', 'p13', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(utilityBangCommit?.type).toBe('internal');
    expect(utilityBangCommit?.breaking).toBe(false);
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
