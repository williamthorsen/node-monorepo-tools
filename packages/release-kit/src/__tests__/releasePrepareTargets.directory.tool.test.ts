import { execFileSync } from 'node:child_process';

import { captureStdio, createTempTree, pointCwdAt, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReleaseKitConfig } from '../configSchema.ts';
import { mergeMonorepoConfig } from '../mergeConfig.ts';
import { applyReleasePlan, type ReleasePlan } from '../releasePlan.ts';
import { releasePrepareTargets, type TargetPrepareOptions } from '../releasePrepareTargets.ts';
import { reportPrepare } from '../reportPrepare.ts';
import { projectMonorepoConfig } from '../resolveReleaseTargets.ts';
import type { TargetPrepareResult } from '../types.ts';

// The fixture packages exist only in the temp repo, so the npm check would refuse them; this suite stays off the network.
vi.mock(import('../npmRegistry.ts'), () => ({
  lookUpNpmPackage: () => ({ status: 'published' }),
}));

const ROOT_PACKAGE = { doesExist: true, version: '0.9.0' };

describe('directory releases (tool)', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = setupFixture();
  });

  it('releases a directory without a package.json from its version.json, writing its changelog in the directory', () => {
    const plan = prepareAndApply(tree, { releases: { app: { path: 'apps/app' } } }, {});

    const app = selectResult(plan, 'app');
    assert(app?.kind === 'directory' && app.status === 'released', 'expected a released directory');
    expect(app.previousTag).toBe('app-v1.0.0');
    expect(app.newVersion).toBe('1.1.0');
    expect(plan.tags).toStrictEqual(['core-v1.0.1', 'app-v1.1.0']);
    expect(tree.readJson('apps/app/version.json')).toStrictEqual({ version: '1.1.0' });

    const changelog = tree.read('apps/app/CHANGELOG.md');
    expect(changelog).toMatch(/## 1\.1\.0 — \d{4}-\d{2}-\d{2}/);
    expect(changelog).toContain('Add the settings screen');
    expect(changelog).not.toContain('Fix the parser');
  }, 60_000);

  it('releases the whole repo from the root target, and a new workspace does not narrow its window', () => {
    commit(tree, 'packages/extra/package.json', JSON.stringify({ name: '@fixture/extra', version: '1.0.0' }), [
      '## extra|feat: Add the extra package',
    ]);
    using stdio = captureStdio();

    const plan = prepareAndApply(tree, { releases: { repo: { path: '.' } } }, {}, ['packages/core', 'packages/extra']);

    // The new workspace has no baseline tag of its own, so the run points at the legacy-prefix check.
    expect(stdio.stderr).toContain("Hint: no baseline tag found for extra under 'extra-v'");

    const repo = selectResult(plan, 'repo');
    assert(repo?.kind === 'directory' && repo.status === 'released', 'expected a released root target');
    expect(repo.tag).toBe('v0.10.0');
    expect(tree.readJson('package.json')).toMatchObject({ version: '0.10.0' });

    const changelog = tree.read('CHANGELOG.md');
    for (const subject of [
      'Add the settings screen',
      'Fix the parser',
      'Document the runbook',
      'Add the extra package',
    ]) {
      expect(changelog).toContain(subject);
    }
  }, 60_000);

  it('archives older sections by major under keptVersionCount, and folds them back once the option is removed', () => {
    commit(
      tree,
      'apps/app/CHANGELOG.md',
      ['# Changelog', '', '## 0.2.0', '', '- Hand-written two', '', '## 0.1.0', '', '- Hand-written one', ''].join(
        '\n',
      ),
      ['## app|docs: Add the early history'],
    );
    const releases: ReleaseKitConfig['releases'] = { app: { path: 'apps/app' } };

    const firstPlan = prepareAndApply(tree, { releases, changelogMarkdown: { keptVersionCount: 1 } }, {});

    const bounded = tree.read('apps/app/CHANGELOG.md');
    expect(bounded).toContain('Earlier versions: [v0](changelogs/CHANGELOG-v0.md).');
    expect(bounded).toMatch(/## 1\.1\.0 — /);
    expect(bounded).not.toContain('Hand-written');
    const archive = tree.read('apps/app/changelogs/CHANGELOG-v0.md');
    expect(archive).toContain('## 0.2.0\n\n- Hand-written two\n\n## 0.1.0\n\n- Hand-written one');

    run(tree, 'git', ['add', '-A']);
    run(tree, 'git', ['commit', '--quiet', '-m', 'release: first']);
    for (const tag of firstPlan.tags) {
      run(tree, 'git', ['tag', tag]);
    }
    commit(tree, 'apps/app/Profile.swift', '// profile\n', ['## app|feat: Add the profile screen']);

    const plan = withinFixture(tree, () => prepare({ releases }, {}, ['packages/core']));
    const report = reportPrepare(plan, { applied: false, style: 'plain' });
    expect(report).toContain('Would remove changelog: apps/app/changelogs/CHANGELOG-v0.md');
    withinFixture(tree, () => applyReleasePlan(plan));

    const restored = tree.read('apps/app/CHANGELOG.md');
    expect(restored).not.toContain('Earlier versions');
    expect(restored).toContain('## 0.2.0\n\n- Hand-written two');
    expect(restored).toContain('## 0.1.0\n\n- Hand-written one');
    expect(tree.exists('apps/app/changelogs/CHANGELOG-v0.md')).toBe(false);
  }, 60_000);

  it('does not report an entry that the root target renders as unrouted', () => {
    commit(tree, 'apps/app/Theme.swift', '// theme\n', [
      '## ui|feat: Add the dark theme',
      [
        '```change-record',
        'entries:',
        '  - type: feat',
        '    scopes: [ui]',
        '    text: Adds the dark theme.',
        '```',
      ].join('\n'),
    ]);

    const plan = prepareAndApply(tree, { releases: { repo: { path: '.' } } }, {});

    const repo = selectResult(plan, 'repo');
    assert(repo?.kind === 'directory' && repo.status === 'released', 'expected a released root target');
    expect(repo).not.toHaveProperty('unroutedEntryScopes');
    expect(tree.read('CHANGELOG.md')).toContain('Adds the dark theme.');
  }, 60_000);

  it("routes a change-record entry to the directory that its scope names, and not to a workspace in the commit's window", () => {
    tree.write('packages/core/shared.ts', 'export const shared = true;\n');
    commit(tree, 'apps/app/Shared.swift', '// shared\n', [
      '## app|feat: Share the model',
      [
        '```change-record',
        'entries:',
        '  - type: feat',
        '    scopes: [app]',
        '    text: Shares the model with the app.',
        '```',
      ].join('\n'),
    ]);

    const plan = prepareAndApply(tree, { releases: { app: { path: 'apps/app' } } }, {});

    const core = selectResult(plan, 'core');
    assert(core?.kind === 'package', 'expected the workspace result');
    expect(core).not.toHaveProperty('unroutedEntryScopes');
    expect(tree.read('apps/app/CHANGELOG.md')).toContain('Shares the model with the app.');
    expect(tree.read('packages/core/CHANGELOG.md')).not.toContain('Shares the model with the app.');
  }, 60_000);

  it('lets a composite include a directory and read its commits', () => {
    const plan = prepareAndApply(tree, { releases: { app: { path: 'apps/app' }, suite: { includes: ['app'] } } }, {});

    const suite = selectResult(plan, 'suite');
    assert(suite?.kind === 'composite' && suite.status === 'released', 'expected a released composite');
    expect(suite.tag).toBe('v0.10.0');
    expect(tree.read('CHANGELOG.md')).toContain('Add the settings screen');
    expect(tree.read('CHANGELOG.md')).not.toContain('Fix the parser');
  }, 60_000);

  it('prepares only the directory that --only names, at the version that --set-version sets', () => {
    const plan = prepareAndApply(
      tree,
      { releases: { app: { path: 'apps/app' } } },
      { only: ['app'], setVersions: new Map([['app', '2.0.0']]) },
    );

    expect(plan.targets.map((result) => result.targetId)).toStrictEqual(['app']);
    expect(plan.tags).toStrictEqual(['app-v2.0.0']);
    expect(tree.readJson('apps/app/version.json')).toStrictEqual({ version: '2.0.0' });
  }, 60_000);

  it('reports a directory under its own section', () => {
    const plan = withinFixture(tree, () => prepare({ releases: { app: { path: 'apps/app' } } }, {}, ['packages/core']));

    const report = reportPrepare(plan, { applied: false, style: 'plain' });

    expect(report).toContain('app');
    expect(report).toContain('[dry-run] Would bump apps/app/version.json');
    expect(report).toContain('app-v1.1.0');
  }, 60_000);
});

// region | Helpers

/** Commits one file in the fixture repo with the given message lines. */
function commit(tree: TempTree, filePath: string, content: string, message: readonly string[]): void {
  tree.write(filePath, content);
  run(tree, 'git', ['add', '-A']);
  run(tree, 'git', ['commit', '--quiet', ...message.flatMap((line) => ['-m', line])]);
}

/** Computes the release plan in the fixture repo and applies it, as the CLI does. */
function prepareAndApply(
  tree: TempTree,
  userConfig: ReleaseKitConfig,
  options: TargetPrepareOptions,
  discoveredPaths: string[] = ['packages/core'],
): ReleasePlan {
  return withinFixture(tree, () => {
    const plan = prepare(userConfig, options, discoveredPaths);
    applyReleasePlan(plan);
    return plan;
  });
}

/** Computes the release plan of a merged config over the discovered workspaces, from the working directory. */
function prepare(userConfig: ReleaseKitConfig, options: TargetPrepareOptions, discoveredPaths: string[]): ReleasePlan {
  const config = mergeMonorepoConfig(
    discoveredPaths,
    { ...userConfig, changelogJson: { enabled: false } },
    ROOT_PACKAGE,
  );
  return releasePrepareTargets(projectMonorepoConfig(config), options);
}

/** Runs a command in the fixture repo. */
function run(tree: TempTree, command: string, args: string[]): void {
  execFileSync(command, args, { cwd: tree.dir, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Returns the result of the target with the given id. */
function selectResult(plan: ReleasePlan, id: string): TargetPrepareResult | undefined {
  return plan.targets.find((result) => result.targetId === id);
}

/**
 * Builds a temp git repo with one workspace (`packages/core`), a SwiftPM-like app directory (`apps/app`) versioned by
 * `version.json`, baseline tags for each and for the root, and since them a fix in the workspace, a feature in the
 * app, and a root-level commit.
 */
function setupFixture(): TempTree {
  const tree = disposeOnTestFinished(createTempTree({}, { prefix: 'release-kit-directory-' }));
  run(tree, 'git', ['init', '--quiet', '--initial-branch=main']);
  run(tree, 'git', ['config', 'user.email', 'test@example.com']);
  run(tree, 'git', ['config', 'user.name', 'Test User']);
  run(tree, 'git', ['config', 'commit.gpgsign', 'false']);
  run(tree, 'git', ['config', 'tag.gpgSign', 'false']);

  tree.writeJson('package.json', { name: 'fixture-monorepo', version: '0.9.0', private: true });
  tree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
  tree.writeJson('packages/core/package.json', { name: '@fixture/core', version: '1.0.0' });
  tree.write('packages/core/index.ts', 'export const core = true;\n');
  tree.writeJson('apps/app/version.json', { version: '1.0.0' });
  tree.write('apps/app/Package.swift', '// swift-tools-version:5.9\n');
  run(tree, 'git', ['add', '-A']);
  run(tree, 'git', ['commit', '--quiet', '-m', 'chore: initial commit']);
  for (const tag of ['v0.9.0', 'core-v1.0.0', 'app-v1.0.0']) {
    run(tree, 'git', ['tag', tag]);
  }

  // The `##` synthetic ticket prefix is required by `classifyChangelogCommit`, which rejects every unticketed commit.
  commit(tree, 'packages/core/parser.ts', 'export const parse = true;\n', ['## core|fix: Fix the parser']);
  commit(tree, 'apps/app/Settings.swift', '// settings\n', ['## app|feat: Add the settings screen']);
  commit(tree, 'docs/runbook.md', '# Runbook\n', ['## root|feat: Document the runbook']);

  return tree;
}

/** Runs `fn` with the working directory, which release-kit reads to resolve paths, pointed at the fixture repo. */
function withinFixture<T>(tree: TempTree, fn: () => T): T {
  using _cwd = pointCwdAt(tree.dir, { chdir: true });

  return fn();
}

// endregion | Helpers
