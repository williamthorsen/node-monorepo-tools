import { describe, expect, it } from 'vitest';

import { buildReleaseSummary } from '../buildReleaseSummary.ts';
import type { PrepareResult } from '../types.ts';

/** Build a minimal PrepareResult for testing. */
function makeResult(overrides?: Partial<PrepareResult>): PrepareResult {
  return {
    workspaces: [],
    tags: [],
    dryRun: false,
    ...overrides,
  };
}

describe(buildReleaseSummary, () => {
  it('produces a summary with tag heading and scope-stripped commits', () => {
    const result = makeResult({
      workspaces: [
        {
          name: 'release-kit',
          status: 'released',
          tag: 'release-kit-v2.4.0',
          commitCount: 2,
          bumpedFiles: [],
          changelogFiles: [],
          commits: [
            { message: 'release-kit|feat: Add commit command', hash: 'abc' },
            { message: '#72 release-kit|fix: Propagate bumps (#80)', hash: 'def' },
          ],
        },
      ],
    });

    expect(buildReleaseSummary(result)).toBe(
      'release-kit-v2.4.0\n- feat: Add commit command\n- #72 fix: Propagate bumps (#80)',
    );
  });

  it('separates multiple workspaces with blank lines', () => {
    const result = makeResult({
      workspaces: [
        {
          name: 'core',
          status: 'released',
          tag: 'core-v1.0.0',
          commitCount: 1,
          bumpedFiles: [],
          changelogFiles: [],
          commits: [{ message: 'core|feat: Init', hash: 'a1' }],
        },
        {
          name: 'utils',
          status: 'released',
          tag: 'utils-v2.0.0',
          commitCount: 1,
          bumpedFiles: [],
          changelogFiles: [],
          commits: [{ message: 'utils|fix: Bug', hash: 'b2' }],
        },
      ],
    });

    expect(buildReleaseSummary(result)).toBe('core-v1.0.0\n- feat: Init\n\nutils-v2.0.0\n- fix: Bug');
  });

  it('omits propagation-only workspaces (no commits)', () => {
    const result = makeResult({
      workspaces: [
        {
          name: 'core',
          status: 'released',
          tag: 'core-v1.0.1',
          commitCount: 0,
          bumpedFiles: [],
          changelogFiles: [],
          propagatedFrom: [{ packageName: '@scope/utils', newVersion: '2.0.0' }],
        },
      ],
    });

    expect(buildReleaseSummary(result)).toBe('');
  });

  it('omits skipped workspaces', () => {
    const result = makeResult({
      workspaces: [
        {
          name: 'skipped-pkg',
          status: 'skipped',
          commitCount: 0,
          bumpedFiles: [],
          changelogFiles: [],
          skipReason: 'No changes',
        },
      ],
    });

    expect(buildReleaseSummary(result)).toBe('');
  });

  it('returns empty string when there are no workspaces', () => {
    expect(buildReleaseSummary(makeResult())).toBe('');
  });

  describe('project release section', () => {
    it('appends the project section after workspace sections when project commits exist', () => {
      const result = makeResult({
        workspaces: [
          {
            name: 'arrays',
            status: 'released',
            tag: 'arrays-v1.1.0',
            commitCount: 1,
            bumpedFiles: [],
            changelogFiles: [],
            commits: [{ message: 'arrays|feat: Add compact', hash: 'a1' }],
          },
        ],
        project: {
          status: 'released',
          commitCount: 1,
          releaseType: 'minor',
          currentVersion: '0.9.0',
          newVersion: '0.10.0',
          tag: 'v0.10.0',
          bumpedFiles: ['./package.json'],
          changelogFiles: ['./CHANGELOG.md'],
          commits: [{ message: 'arrays|feat: Add compact', hash: 'a1' }],
        },
      });

      expect(buildReleaseSummary(result)).toBe('arrays-v1.1.0\n- feat: Add compact\n\nv0.10.0\n- feat: Add compact');
    });

    it('emits only the project section when no workspace contributed commits', () => {
      const result = makeResult({
        project: {
          status: 'released',
          commitCount: 1,
          releaseType: 'patch',
          currentVersion: '0.9.0',
          newVersion: '0.9.1',
          tag: 'v0.9.1',
          bumpedFiles: ['./package.json'],
          changelogFiles: ['./CHANGELOG.md'],
          commits: [{ message: 'arrays|fix: Patch bug', hash: 'b1' }],
        },
      });

      expect(buildReleaseSummary(result)).toBe('v0.9.1\n- fix: Patch bug');
    });

    it('omits the project section when no project commits exist', () => {
      const result = makeResult({
        project: {
          status: 'released',
          commitCount: 0,
          releaseType: 'patch',
          currentVersion: '0.9.0',
          newVersion: '0.9.1',
          tag: 'v0.9.1',
          bumpedFiles: ['./package.json'],
          changelogFiles: ['./CHANGELOG.md'],
          commits: [],
        },
      });

      expect(buildReleaseSummary(result)).toBe('');
    });

    it('omits a skipped project from the summary', () => {
      // The summary surface only describes the actual release outcome; a skipped project
      // produces no tag and no commits to attribute, so it must not appear in the summary.
      const result = makeResult({
        workspaces: [
          {
            name: 'arrays',
            status: 'released',
            tag: 'arrays-v1.1.0',
            commitCount: 1,
            bumpedFiles: [],
            changelogFiles: [],
            commits: [{ message: 'arrays|feat: Add compact', hash: 'a1' }],
          },
        ],
        project: {
          status: 'skipped',
          previousTag: 'v0.9.0',
          commitCount: 0,
          bumpedFiles: [],
          changelogFiles: [],
          skipReason: 'No commits since v0.9.0. Pass --force to release at patch. Skipping.',
        },
      });

      expect(buildReleaseSummary(result)).toBe('arrays-v1.1.0\n- feat: Add compact');
    });
  });
});
