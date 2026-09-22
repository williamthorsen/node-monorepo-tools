import { describe, expect, it } from 'vitest';

import { classifyChangelogCommit } from '../classifyChangelogCommit.ts';
import { DEFAULT_WORK_TYPES } from '../defaults.ts';

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
      expect(classifyChangelogCommit(`#1 ${typeName}: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"PROJ-1 %s: test" is classified as "%s"', (typeName, header) => {
      expect(classifyChangelogCommit(`PROJ-1 ${typeName}: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"## %s: test" is classified as "%s"', (typeName, header) => {
      expect(classifyChangelogCommit(`## ${typeName}: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"#1.2 %s: test" (dot sub-ticket) is classified as "%s"', (typeName, header) => {
      expect(classifyChangelogCommit(`#1.2 ${typeName}: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"#1-2 %s: test" (dash sub-ticket) is classified as "%s"', (typeName, header) => {
      expect(classifyChangelogCommit(`#1-2 ${typeName}: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"#1 scope|%s: test" (pipe scope) is classified as "%s"', (typeName, header) => {
      expect(classifyChangelogCommit(`#1 scope|${typeName}: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"#1 *|%s: test" (structural scope) is classified as "%s"', (typeName, header) => {
      expect(classifyChangelogCommit(`#1 *|${typeName}: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"#1 %s!: test" (breaking) is classified as "%s"', (typeName, header) => {
      expect(classifyChangelogCommit(`#1 ${typeName}!: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"#1 scope|%s!: test" (pipe breaking) is classified as "%s"', (typeName, header) => {
      expect(classifyChangelogCommit(`#1 scope|${typeName}!: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });

    it.each(INCLUDED_TYPES)('"#1 *|%s!: test" (structural breaking) is classified as "%s"', (typeName, header) => {
      expect(classifyChangelogCommit(`#1 *|${typeName}!: test`, DEFAULT_WORK_TYPES)).toBe(header);
    });
  });

  describe('a header comes from the configured work types', () => {
    it('reads the header a consumer override supplies', () => {
      const workTypes = { ...DEFAULT_WORK_TYPES, feat: { header: 'New stuff' } };
      expect(classifyChangelogCommit('#1 feat: Add widget', workTypes)).toBe('New stuff');
    });

    it('classifies a type a consumer adds', () => {
      const workTypes = { ...DEFAULT_WORK_TYPES, chore: { header: '🧹 Chores' } };
      expect(classifyChangelogCommit('#1 chore: Tidy up', workTypes)).toBe('🧹 Chores');
    });

    it('rejects a type a consumer excludes from the changelog', () => {
      const workTypes = { ...DEFAULT_WORK_TYPES, docs: { header: '📚 Documentation', excludedFromChangelog: true } };
      expect(classifyChangelogCommit('#1 docs: Update guide', workTypes)).toBeUndefined();
    });
  });

  describe('excluded types reach no changelog', () => {
    it.each(EXCLUDED_TYPE_NAMES)('"#1 %s: test" is rejected', (typeName) => {
      expect(classifyChangelogCommit(`#1 ${typeName}: test`, DEFAULT_WORK_TYPES)).toBeUndefined();
    });

    it.each([
      '#1 fmt: Run prettier',
      '#1 scope|fmt: Run prettier',
      '#1 *|fmt: Run prettier',
      '#1 fmt!: Breaking format change',
      '## fmt: Ad-hoc formatting',
      'PROJ-1 fmt: Jira-style formatting',
    ])('rejects "%s"', (message) => {
      expect(classifyChangelogCommit(message, DEFAULT_WORK_TYPES)).toBeUndefined();
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
      expect(classifyChangelogCommit(message, DEFAULT_WORK_TYPES)).toBeUndefined();
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
      expect(classifyChangelogCommit(message, DEFAULT_WORK_TYPES)).toBeUndefined();
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
      expect(classifyChangelogCommit(message, DEFAULT_WORK_TYPES)).toBeUndefined();
    });

    it('rejects a ticketed subject carrying no type separator', () => {
      expect(classifyChangelogCommit('#1 Add a widget', DEFAULT_WORK_TYPES)).toBeUndefined();
    });
  });

  describe('the subject alone decides', () => {
    it('classifies from the first line when a body follows', () => {
      const message = '#1 feat: Add widget\n\nA paragraph about the widget.';
      expect(classifyChangelogCommit(message, DEFAULT_WORK_TYPES)).toBe(DEFAULT_WORK_TYPES['feat']?.header);
    });

    it('ignores a `release:` line inside the body', () => {
      const message = '#1 feat: Add widget\n\nrelease: not a subject';
      expect(classifyChangelogCommit(message, DEFAULT_WORK_TYPES)).toBe(DEFAULT_WORK_TYPES['feat']?.header);
    });
  });
});
