import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_BREAKING_POLICIES, DEFAULT_WORK_TYPES } from '../defaults.ts';
import { parseCommitMessage, type PolicyViolationHandler } from '../parseCommitMessage.ts';
import type { WorkTypeConfig } from '../types.ts';

const workTypes: Record<string, WorkTypeConfig> = {
  fix: { header: 'Bug fixes', aliases: ['bugfix'] },
  feat: { header: 'Features', aliases: ['feature'] },
  refactor: { header: 'Refactoring' },
  docs: { header: 'Documentation', aliases: ['doc'] },
};

describe(parseCommitMessage, () => {
  it('parses a simple "type: description" message', () => {
    const result = parseCommitMessage('feat: add login page', 'abc123', workTypes);
    expect(result).toStrictEqual({
      message: 'feat: add login page',
      hash: 'abc123',
      type: 'feat',
      description: 'add login page',
      breaking: false,
    });
  });

  it('parses a "scope|type: description" message', () => {
    const result = parseCommitMessage('web|fix: resolve navbar bug', 'def456', workTypes);
    expect(result).toStrictEqual({
      message: 'web|fix: resolve navbar bug',
      hash: 'def456',
      type: 'fix',
      description: 'resolve navbar bug',
      scope: 'web',
      breaking: false,
    });
  });

  it('resolves an alias to its canonical type', () => {
    const result = parseCommitMessage('feature: new dashboard', 'ghi789', workTypes);
    expect(result).toStrictEqual({
      message: 'feature: new dashboard',
      hash: 'ghi789',
      type: 'feat',
      description: 'new dashboard',
      breaking: false,
    });
  });

  it('resolves an alias in scope|type format', () => {
    const result = parseCommitMessage('api|bugfix: fix timeout', 'jkl012', workTypes);
    expect(result).toStrictEqual({
      message: 'api|bugfix: fix timeout',
      hash: 'jkl012',
      type: 'fix',
      description: 'fix timeout',
      scope: 'api',
      breaking: false,
    });
  });

  it('detects a breaking change via ! marker', () => {
    const result = parseCommitMessage('feat!: redesign API', 'mno345', workTypes);
    expect(result).toBeDefined();
    expect(result?.breaking).toBe(true);
  });

  it('detects a breaking change via BREAKING CHANGE in message', () => {
    const result = parseCommitMessage('feat: new API BREAKING CHANGE: removed old endpoint', 'pqr678', workTypes);
    expect(result).toBeDefined();
    expect(result?.breaking).toBe(true);
  });

  it('returns undefined for an unrecognized type', () => {
    const result = parseCommitMessage('unknown: some change', 'stu901', workTypes);
    expect(result).toBeUndefined();
  });

  it('returns undefined for a message without a type prefix', () => {
    const result = parseCommitMessage('just a plain message', 'vwx234', workTypes);
    expect(result).toBeUndefined();
  });

  it('returns undefined for an empty message', () => {
    const result = parseCommitMessage('', 'yz5678', workTypes);
    expect(result).toBeUndefined();
  });

  it('handles doc alias', () => {
    const result = parseCommitMessage('doc: update README', 'abc999', workTypes);
    expect(result).toStrictEqual({
      message: 'doc: update README',
      hash: 'abc999',
      type: 'docs',
      description: 'update README',
      breaking: false,
    });
  });

  it('resolves an uppercase type to its canonical lowercase form', () => {
    const result = parseCommitMessage('FEAT: add login', 'upper1', workTypes);
    expect(result).toStrictEqual({
      message: 'FEAT: add login',
      hash: 'upper1',
      type: 'feat',
      description: 'add login',
      breaking: false,
    });
  });

  it('resolves a mixed-case alias to its canonical type', () => {
    const result = parseCommitMessage('Feature: new dashboard', 'upper2', workTypes);
    expect(result).toStrictEqual({
      message: 'Feature: new dashboard',
      hash: 'upper2',
      type: 'feat',
      description: 'new dashboard',
      breaking: false,
    });
  });

  it('parses a scope prefix combined with a breaking change marker', () => {
    const result = parseCommitMessage('api|feat!: redesign endpoint', 'combo1', workTypes);
    expect(result).toStrictEqual({
      message: 'api|feat!: redesign endpoint',
      hash: 'combo1',
      type: 'feat',
      description: 'redesign endpoint',
      scope: 'api',
      breaking: true,
    });
  });

  describe('ticket-prefix stripping', () => {
    it('strips the ## synthetic prefix before parsing', () => {
      const result = parseCommitMessage('## feat: add quick utility', 'sp1', workTypes);
      expect(result).toStrictEqual({
        message: '## feat: add quick utility',
        hash: 'sp1',
        type: 'feat',
        description: 'add quick utility',
        breaking: false,
      });
    });

    it('strips the ## prefix with scope|type format', () => {
      const result = parseCommitMessage('## web|fix: patch layout', 'sp2', workTypes);
      expect(result).toStrictEqual({
        message: '## web|fix: patch layout',
        hash: 'sp2',
        type: 'fix',
        description: 'patch layout',
        breaking: false,
        scope: 'web',
      });
    });

    it('strips a GitHub-style ticket prefix before parsing', () => {
      const result = parseCommitMessage('#8 feat: add thing', 'tp1', workTypes);
      expect(result).toStrictEqual({
        message: '#8 feat: add thing',
        hash: 'tp1',
        type: 'feat',
        description: 'add thing',
        breaking: false,
      });
    });

    it('strips a Jira-style ticket prefix before parsing', () => {
      const result = parseCommitMessage('TOOL-123 fix: resolve bug', 'tp2', workTypes);
      expect(result).toStrictEqual({
        message: 'TOOL-123 fix: resolve bug',
        hash: 'tp2',
        type: 'fix',
        description: 'resolve bug',
        breaking: false,
      });
    });

    it('strips a ticket prefix with scope|type format', () => {
      const result = parseCommitMessage('#8 web|feat: add thing', 'tp3', workTypes);
      expect(result).toStrictEqual({
        message: '#8 web|feat: add thing',
        hash: 'tp3',
        type: 'feat',
        description: 'add thing',
        scope: 'web',
        breaking: false,
      });
    });

    it('preserves the original message including prefix in the result', () => {
      const result = parseCommitMessage('#42 docs: update guide', 'tp4', workTypes);
      expect(result?.message).toBe('#42 docs: update guide');
    });

    it('strips a GitHub-style sub-ticket prefix with hyphen separator', () => {
      const result = parseCommitMessage('#123-1 feat: add thing', 'tp6', workTypes);
      expect(result).toStrictEqual({
        message: '#123-1 feat: add thing',
        hash: 'tp6',
        type: 'feat',
        description: 'add thing',
        breaking: false,
      });
    });

    it('strips a GitHub-style sub-ticket prefix with dot separator', () => {
      const result = parseCommitMessage('#123.2 fix: resolve bug', 'tp7', workTypes);
      expect(result).toStrictEqual({
        message: '#123.2 fix: resolve bug',
        hash: 'tp7',
        type: 'fix',
        description: 'resolve bug',
        breaking: false,
      });
    });

    it('strips a sub-ticket prefix with scope|type format', () => {
      const result = parseCommitMessage('#42-3 web|feat: add dashboard', 'tp8', workTypes);
      expect(result).toStrictEqual({
        message: '#42-3 web|feat: add dashboard',
        hash: 'tp8',
        type: 'feat',
        description: 'add dashboard',
        scope: 'web',
        breaking: false,
      });
    });

    it('does not strip patterns that are not at the start of the message', () => {
      const result = parseCommitMessage('feat: close #8 issue', 'tp5', workTypes);
      expect(result).toStrictEqual({
        message: 'feat: close #8 issue',
        hash: 'tp5',
        type: 'feat',
        description: 'close #8 issue',
        breaking: false,
      });
    });
  });

  describe('conventional commit format — type(scope): description', () => {
    it('parses a "type(scope): description" message', () => {
      const result = parseCommitMessage('fix(parser): handle edge case', 'cc1', workTypes);
      expect(result).toStrictEqual({
        message: 'fix(parser): handle edge case',
        hash: 'cc1',
        type: 'fix',
        description: 'handle edge case',
        scope: 'parser',
        breaking: false,
      });
    });

    it('parses a breaking change with parenthesized scope', () => {
      const result = parseCommitMessage('feat(api)!: redesign endpoint', 'cc2', workTypes);
      expect(result).toStrictEqual({
        message: 'feat(api)!: redesign endpoint',
        hash: 'cc2',
        type: 'feat',
        description: 'redesign endpoint',
        scope: 'api',
        breaking: true,
      });
    });

    it('resolves an alias with parenthesized scope', () => {
      const result = parseCommitMessage('feature(web): add dashboard', 'cc3', workTypes);
      expect(result).toStrictEqual({
        message: 'feature(web): add dashboard',
        hash: 'cc3',
        type: 'feat',
        description: 'add dashboard',
        scope: 'web',
        breaking: false,
      });
    });

    it('strips a ticket prefix with conventional format', () => {
      const result = parseCommitMessage('#42 fix(core): patch null check', 'cc4', workTypes);
      expect(result).toStrictEqual({
        message: '#42 fix(core): patch null check',
        hash: 'cc4',
        type: 'fix',
        description: 'patch null check',
        scope: 'core',
        breaking: false,
      });
    });

    it('resolves scope aliases in conventional format', () => {
      const aliases: Record<string, string> = { api: 'backend-api' };
      const result = parseCommitMessage('fix(api): fix timeout', 'cc5', workTypes, aliases);
      expect(result).toStrictEqual({
        message: 'fix(api): fix timeout',
        hash: 'cc5',
        type: 'fix',
        description: 'fix timeout',
        scope: 'backend-api',
        breaking: false,
      });
    });

    it('gives pipe scope precedence over parenthesized scope', () => {
      const result = parseCommitMessage('web|feat(other): add thing', 'cc6', workTypes);
      expect(result).toStrictEqual({
        message: 'web|feat(other): add thing',
        hash: 'cc6',
        type: 'feat',
        description: 'add thing',
        scope: 'web',
        breaking: false,
      });
    });
  });

  describe('scope alias resolution', () => {
    const aliases: Record<string, string> = {
      api: 'backend-api',
      web: 'frontend-web',
    };

    it('resolves a scope alias to its canonical name', () => {
      const result = parseCommitMessage('api|fix: fix timeout', 'ws1', workTypes, aliases);
      expect(result).toStrictEqual({
        message: 'api|fix: fix timeout',
        hash: 'ws1',
        type: 'fix',
        description: 'fix timeout',
        scope: 'backend-api',
        breaking: false,
      });
    });

    it('passes through an unknown scope unchanged', () => {
      const result = parseCommitMessage('mobile|feat: add splash screen', 'ws2', workTypes, aliases);
      expect(result).toStrictEqual({
        message: 'mobile|feat: add splash screen',
        hash: 'ws2',
        type: 'feat',
        description: 'add splash screen',
        scope: 'mobile',
        breaking: false,
      });
    });

    it('does not resolve scope aliases when no alias map is provided', () => {
      const result = parseCommitMessage('api|fix: fix timeout', 'ws3', workTypes);
      expect(result).toStrictEqual({
        message: 'api|fix: fix timeout',
        hash: 'ws3',
        type: 'fix',
        description: 'fix timeout',
        scope: 'api',
        breaking: false,
      });
    });

    it('resolves scope alias with breaking change marker', () => {
      const result = parseCommitMessage('web|feat!: redesign layout', 'ws4', workTypes, aliases);
      expect(result).toStrictEqual({
        message: 'web|feat!: redesign layout',
        hash: 'ws4',
        type: 'feat',
        description: 'redesign layout',
        scope: 'frontend-web',
        breaking: true,
      });
    });
  });
});

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

  it('treats bare `drop:` as a policy violation; accepts `drop!` and `drop(scope)!`', () => {
    const onPolicyViolation = vi.fn<PolicyViolationHandler>();

    const dropBare = parseCommitMessage('drop: remove API', 'p7', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(dropBare?.type).toBe('drop');
    expect(dropBare?.breaking).toBe(false);
    expect(onPolicyViolation).toHaveBeenCalledTimes(1);
    expect(onPolicyViolation).toHaveBeenCalledWith({ message: 'drop: remove API', hash: 'p7' }, 'drop', 'prefix');

    onPolicyViolation.mockClear();
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
      { message: 'internal!: refactor helper', hash: 'p12' },
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
      { message: 'utility!: refactor helper', hash: 'p13' },
      'internal',
      'prefix',
    );
  });

  it.each([
    ['fix!', 'fix'],
    ['bugfix!', 'fix'],
    ['perf!', 'perf'],
    ['performance!', 'perf'],
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
    expect(onPolicyViolation).toHaveBeenCalledWith({ message, hash: 'h' }, canonicalType, 'prefix');
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
    const message = 'fix: patch null check\n\nBREAKING CHANGE: removes deprecated path';
    const result = parseCommitMessage(message, 'p14', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(result?.type).toBe('fix');
    expect(result?.breaking).toBe(false);
    expect(onPolicyViolation).toHaveBeenCalledWith({ message, hash: 'p14' }, 'fix', 'body');
  });

  it('reports both prefix and body surfaces independently when both are present on a forbidden type', () => {
    const onPolicyViolation = vi.fn<PolicyViolationHandler>();
    const message = 'fix!: patch null check\n\nBREAKING CHANGE: removes deprecated path';
    const result = parseCommitMessage(message, 'p15', DEFAULT_WORK_TYPES, undefined, {
      breakingPolicies: DEFAULT_BREAKING_POLICIES,
      onPolicyViolation,
    });
    expect(result?.breaking).toBe(false);
    expect(onPolicyViolation).toHaveBeenCalledTimes(2);
    expect(onPolicyViolation).toHaveBeenCalledWith({ message, hash: 'p15' }, 'fix', 'prefix');
    expect(onPolicyViolation).toHaveBeenCalledWith({ message, hash: 'p15' }, 'fix', 'body');
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
