import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTempTree, pointCwdAt, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { assert, beforeEach, describe, expect, it } from 'vitest';

import { mergeMonorepoConfig } from '../loadConfig.ts';
import { applyReleasePlan } from '../releasePlan.ts';
import { releasePrepareMono } from '../releasePrepareMono.ts';

/** The root changelog, hand-written before release-kit was adopted. */
const ROOT_CHANGELOG = `# Changelog

## [Unreleased]

## [1.3.0] - 2026-08-01

### Added

- Root feature three.

## [1.2.0] - 2026-07-01

- Root feature two.

## [1.1.0] - 2026-06-01

- Root feature one.
`;

/** The `api` workspace's changelog, hand-written before release-kit was adopted. */
const API_CHANGELOG = `# api

## v1.2.0

- API change two.

## v1.1.0

- API change one.

## v1.0.0

Initial release.
`;

/**
 * Covers adopting release-kit in a repo shaped like `templates.node-monorepo`: hand-written multi-version changelogs,
 * no `changelog.json`, and released current versions that were never tagged.
 */
describe('untagged changelog versions (tool)', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = setupFixture();
  });

  it('stops until every recorded current version is tagged, then keeps every version the tags do not rebuild', () => {
    using _cwd = pointCwdAt(tree.dir, { chdir: true });
    const config = mergeMonorepoConfig(
      ['packages/api'],
      { project: {}, changelogJson: { enabled: false } },
      { exists: true, version: '1.3.0' },
    );

    expect(() => releasePrepareMono(config, {})).toThrow("workspace 'api': 1.2.0 (create tag api-v1.2.0)");
    git(tree, 'tag', 'api-v1.2.0');

    expect(() => releasePrepareMono(config, { force: true })).toThrow('project: 1.3.0 (create tag v1.3.0)');
    git(tree, 'tag', 'v1.3.0');

    tree.write('packages/api/widget.ts', 'export const widget = true;\n');
    commitAll(tree, '## api|feat: Add widget');

    const plan = releasePrepareMono(config, {});
    applyReleasePlan(plan);

    expect(plan.tags).toStrictEqual(['api-v1.3.0', 'v1.4.0']);
    const apiChangelog = readFileSync(join(tree.dir, 'packages/api/CHANGELOG.md'), 'utf8');
    expect(listHeadings(apiChangelog)).toStrictEqual([
      expect.stringMatching(/^## 1\.3\.0 — /),
      expect.stringMatching(/^## 1\.2\.0 — /),
      '## v1.1.0',
      '## v1.0.0',
    ]);
    expect(apiChangelog).toContain('- Add widget');
    expect(apiChangelog).toContain('## v1.0.0\n\nInitial release.\n');

    const rootChangelog = readFileSync(join(tree.dir, 'CHANGELOG.md'), 'utf8');
    expect(listHeadings(rootChangelog)).toStrictEqual([
      expect.stringMatching(/^## 1\.4\.0 — /),
      expect.stringMatching(/^## 1\.3\.0 — /),
      '## [1.2.0] - 2026-07-01',
      '## [1.1.0] - 2026-06-01',
    ]);
    expect(rootChangelog).not.toContain('Root feature three.');
    expect(rootChangelog).toContain('## [1.2.0] - 2026-07-01\n\n- Root feature two.\n');

    const project = plan.project;
    assert(project?.status === 'released', 'expected released project');
    expect(project.commitCount).toBe(1);
    expect(project.changelogPreservation).toStrictEqual([
      {
        file: 'CHANGELOG.md',
        preservedVersions: ['1.2.0', '1.1.0'],
        droppedUnversionedHeadings: ['## [Unreleased]'],
      },
    ]);
  }, 60_000);
});

// region | Helpers

/** Stages every change and commits it with `message`. */
function commitAll(tree: TempTree, message: string): void {
  git(tree, 'add', '-A');
  git(tree, 'commit', '--quiet', '--message', message);
}

/** Runs git in the fixture repo. */
function git(tree: TempTree, ...args: string[]): void {
  execFileSync('git', args, { cwd: tree.dir, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Returns the `##` headings of a changelog, in order. */
function listHeadings(content: string): string[] {
  return content.split('\n').filter((line) => line.startsWith('## '));
}

/**
 * Builds a git repo with one workspace, `api`, whose released versions are recorded only in hand-written changelogs.
 * The one tag, `v1.0.9`, matches no recorded version.
 */
function setupFixture(): TempTree {
  const tree = disposeOnTestFinished(createTempTree({}, { prefix: 'release-kit-untagged-' }));
  git(tree, 'init', '--quiet', '--initial-branch=main');
  git(tree, 'config', 'user.email', 'test@example.com');
  git(tree, 'config', 'user.name', 'Test User');
  git(tree, 'config', 'commit.gpgsign', 'false');
  git(tree, 'config', 'tag.gpgSign', 'false');

  tree.writeJson('package.json', { name: 'fixture-monorepo', version: '1.0.9', private: true });
  tree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
  tree.writeJson('packages/api/package.json', { name: '@fixture/api', version: '1.0.0' });
  tree.write('packages/api/index.ts', 'export const api = true;\n');
  commitAll(tree, 'chore: initial commit');
  git(tree, 'tag', 'v1.0.9');

  for (const [index, subject] of [
    'feat: Add endpoint',
    'fix: Repair endpoint',
    'feat: Add second endpoint',
  ].entries()) {
    tree.write(`packages/api/change-${index}.ts`, `export const change = ${index};\n`);
    commitAll(tree, `## api|${subject}`);
  }

  tree.writeJson('package.json', { name: 'fixture-monorepo', version: '1.3.0', private: true });
  tree.writeJson('packages/api/package.json', { name: '@fixture/api', version: '1.2.0' });
  tree.write('CHANGELOG.md', ROOT_CHANGELOG);
  tree.write('packages/api/CHANGELOG.md', API_CHANGELOG);
  commitAll(tree, 'release: api 1.2.0, project 1.3.0');

  return tree;
}

// endregion | Helpers
