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
});
