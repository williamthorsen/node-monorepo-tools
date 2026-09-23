import { describe, expect, it, vi } from 'vitest';

import { type ChangelogClassification, classifyChangelogCommit } from '../classifyChangelogCommit.ts';
import { DEFAULT_BREAKING_POLICIES, DEFAULT_WORK_TYPES } from '../defaults.ts';
import type { PolicyViolationSurface } from '../parseCommitMessage.ts';
import type { WorkTypeConfig } from '../types.ts';

/** Types whose commits reach a changelog, each paired with the header its type declares. */
const INCLUDED_TYPES: Array<readonly [string, string]> = Object.entries(DEFAULT_WORK_TYPES)
  .filter(([, config]) => config.excludedFromChangelog !== true)
  .flatMap(([key, config]) => [
    [key, config.header] as const,
    ...(config.aliases ?? []).map((alias) => [alias, config.header] as const),
  ]);

/** Types that the taxonomy excludes from the changelog, with their aliases. */
const EXCLUDED_TYPE_NAMES: string[] = Object.entries(DEFAULT_WORK_TYPES)
  .filter(([, config]) => config.excludedFromChangelog === true)
  .flatMap(([key, config]) => [key, ...(config.aliases ?? [])]);

describe(classifyChangelogCommit, () => {
  describe('every work type reaches its declared header', () => {
    it.each(INCLUDED_TYPES)('"#1 %s: test" is classified as "%s"', (typeName, header) => {
      expect(headerOf(`#1 ${typeName}: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"PROJ-1 %s: test" is classified as "%s"', (typeName, header) => {
      expect(headerOf(`PROJ-1 ${typeName}: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"## %s: test" is classified as "%s"', (typeName, header) => {
      expect(headerOf(`## ${typeName}: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"#1.2 %s: test" (dot sub-ticket) is classified as "%s"', (typeName, header) => {
      expect(headerOf(`#1.2 ${typeName}: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"#1-2 %s: test" (dash sub-ticket) is classified as "%s"', (typeName, header) => {
      expect(headerOf(`#1-2 ${typeName}: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"#1 scope|%s: test" (pipe scope) is classified as "%s"', (typeName, header) => {
      expect(headerOf(`#1 scope|${typeName}: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"#1 *|%s: test" (structural scope) is classified as "%s"', (typeName, header) => {
      expect(headerOf(`#1 *|${typeName}: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"#1 %s!: test" (breaking) is classified as "%s"', (typeName, header) => {
      expect(headerOf(`#1 ${typeName}!: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"#1 scope|%s!: test" (pipe breaking) is classified as "%s"', (typeName, header) => {
      expect(headerOf(`#1 scope|${typeName}!: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"#1 *|%s!: test" (structural breaking) is classified as "%s"', (typeName, header) => {
      expect(headerOf(`#1 *|${typeName}!: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });
  });

  describe('every subject form `parseCommitMessage` accepts reaches its section', () => {
    // The parsers this function replaced required the colon immediately after the type and matched
    // case-sensitively, so no subject below reached a changelog. Classification now follows
    // `parseCommitMessage`, which accepts all of them; these assertions pin that widening.
    it('classifies a conventional-commit parenthesized scope', () => {
      expect(headerOf('#1 fix(parser): Patch', DEFAULT_WORK_TYPES)).toBe(DEFAULT_WORK_TYPES['fix']?.header);
    });

    it('classifies a parenthesized scope carrying a breaking marker', () => {
      expect(headerOf('#1 fix(parser)!: Patch', DEFAULT_WORK_TYPES)).toBe(DEFAULT_WORK_TYPES['fix']?.header);
    });

    it.each(['#1 FEAT: Shout', '#1 Feat: Title case'])('resolves the type case-insensitively in "%s"', (message) => {
      expect(headerOf(message, DEFAULT_WORK_TYPES)).toBe(DEFAULT_WORK_TYPES['feat']?.header);
    });

    it('rejects an excluded type under a parenthesized scope', () => {
      expect(kindOf('#1 fmt(css): Run prettier', DEFAULT_WORK_TYPES)).toBe('excluded');
    });
  });

  describe('a header comes from the configured work types', () => {
    it('reads the header a consumer override supplies', () => {
      const workTypes = { ...DEFAULT_WORK_TYPES, feat: { header: 'New stuff' } };
      expect(headerOf('#1 feat: Add widget', workTypes)).toBe('New stuff');
    });

    it('classifies a type a consumer adds', () => {
      const workTypes = { ...DEFAULT_WORK_TYPES, chore: { header: '🧹 Chores' } };
      expect(headerOf('#1 chore: Tidy up', workTypes)).toBe('🧹 Chores');
    });

    it('rejects a type a consumer excludes from the changelog', () => {
      const workTypes = { ...DEFAULT_WORK_TYPES, docs: { header: '📚 Documentation', excludedFromChangelog: true } };
      expect(kindOf('#1 docs: Update guide', workTypes)).toBe('excluded');
    });
  });

  describe('excluded types reach no changelog', () => {
    it.each(EXCLUDED_TYPE_NAMES)('"#1 %s: test" is rejected', (typeName) => {
      expect(kindOf(`#1 ${typeName}: test`, DEFAULT_WORK_TYPES)).toBe('excluded');
    });

    it.each([
      '#1 fmt: Run prettier',
      '#1 scope|fmt: Run prettier',
      '#1 *|fmt: Run prettier',
      '#1 fmt!: Breaking format change',
      '## fmt: Ad-hoc formatting',
      'PROJ-1 fmt: Jira-style formatting',
    ])('rejects "%s"', (message) => {
      expect(kindOf(message, DEFAULT_WORK_TYPES)).toBe('excluded');
    });
  });

  describe('unticketed commits reach no changelog', () => {
    it.each([
      'feat: Add new feature',
      'scope|fix: Fix bug',
      'tooling: Generate repo labels',
      'chore: bump deps',
      'Update readme',
      'wip stuff',
      '###feat: Not a synthetic ticket',
      'proj-1 feat: Lowercase Jira prefix',
    ])('rejects "%s"', (message) => {
      expect(kindOf(message, DEFAULT_WORK_TYPES)).toBe('unparseable');
    });
  });

  describe('release and merge commits reach no changelog', () => {
    it.each([
      'release: nmr-core-v0.13.0 nmr-v0.39.0',
      'release: v1.0.0',
      'Merge pull request #1 from owner/branch',
      'Merge branch "main" into feature',
      'Merge remote-tracking branch "origin/main"',
    ])('rejects "%s"', (message) => {
      expect(kindOf(message, DEFAULT_WORK_TYPES)).toBe('excluded');
    });
  });

  describe('undeclared types reach no changelog', () => {
    it.each([
      '#1 chore: Rework build',
      '#1 chore!: Rework build',
      '#1 wip: Half-done',
      '#1 scope|chore: Rework build',
      'PROJ-1 chore: Rework build',
    ])('rejects "%s"', (message) => {
      expect(kindOf(message, DEFAULT_WORK_TYPES)).toBe('unparseable');
    });

    it('rejects a ticketed subject carrying no type separator', () => {
      expect(kindOf('#1 Add a widget', DEFAULT_WORK_TYPES)).toBe('unparseable');
    });
  });

  describe('the subject alone decides', () => {
    it('classifies from the first line when a body follows', () => {
      const message = '#1 feat: Add widget\n\nA paragraph about the widget.';
      expect(headerOf(message, DEFAULT_WORK_TYPES)).toBe(DEFAULT_WORK_TYPES['feat']?.header);
    });

    it('ignores a `release:` line inside the body', () => {
      const message = '#1 feat: Add widget\n\nrelease: not a subject';
      expect(headerOf(message, DEFAULT_WORK_TYPES)).toBe(DEFAULT_WORK_TYPES['feat']?.header);
    });
  });

  describe('a header result carries the resolved type and the parsed breaking flag', () => {
    it('resolves an alias to its canonical type', () => {
      expect(classify('#1 feature: Add widget')).toStrictEqual({
        kind: 'header',
        header: DEFAULT_WORK_TYPES['feat']?.header,
        type: 'feat',
        breaking: false,
      });
    });

    it('reads a `BREAKING CHANGE:` footer as breaking under an optional policy', () => {
      expect(classify('#1 feat: Add widget\n\nBREAKING CHANGE: removes /v1')).toMatchObject({ breaking: true });
    });

    it('drops the marker of a type whose policy forbids it', () => {
      expect(classify('#1 refactor!: Restructure', { breakingPolicies: DEFAULT_BREAKING_POLICIES })).toMatchObject({
        breaking: false,
      });
    });
  });

  describe('policy violations', () => {
    it.each([
      ['#1 drop: Remove the flag', 'drop', 'prefix'],
      ['#1 refactor: Restructure\n\nBREAKING CHANGE: renames the export', 'refactor', 'body'],
      ['#1 fmt!: Reformat', 'fmt', 'prefix'],
    ])('reports "%s" with the commit hash', (message, type, surface) => {
      const violations: Array<{ hash: string; type: string; surface: PolicyViolationSurface }> = [];

      classify(message, {
        breakingPolicies: DEFAULT_BREAKING_POLICIES,
        onPolicyViolation: (commit, violatedType, violatedSurface) => {
          violations.push({ hash: commit.hash, type: violatedType, surface: violatedSurface });
        },
      });

      expect(violations).toStrictEqual([{ hash: 'abc123', type, surface }]);
    });

    it('reports nothing for an unticketed commit, which it does not parse', () => {
      const onPolicyViolation = vi.fn();

      classify('drop: Remove the flag', { breakingPolicies: DEFAULT_BREAKING_POLICIES, onPolicyViolation });

      expect(onPolicyViolation).not.toHaveBeenCalled();
    });
  });
});

// region | Helpers

/** Classifies a message under the default work types. */
function classify(message: string, options?: Parameters<typeof classifyChangelogCommit>[2]): ChangelogClassification {
  return classifyChangelogCommit({ hash: 'abc123', message }, DEFAULT_WORK_TYPES, options);
}

/** Returns the header of a message that classifies under one, and undefined otherwise. */
function headerOf(message: string, workTypes: Record<string, WorkTypeConfig>): string | undefined {
  const classification = classifyChangelogCommit({ hash: 'abc123', message }, workTypes);
  return classification.kind === 'header' ? classification.header : undefined;
}

/** Returns the kind of a message's classification. */
function kindOf(message: string, workTypes: Record<string, WorkTypeConfig>): ChangelogClassification['kind'] {
  return classifyChangelogCommit({ hash: 'abc123', message }, workTypes).kind;
}

// endregion | Helpers
