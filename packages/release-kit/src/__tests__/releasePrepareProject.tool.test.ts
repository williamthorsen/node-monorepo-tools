import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { captureStdio, pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished, silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { assert, beforeEach, describe, expect, it } from 'vitest';

import { mergeMonorepoConfig } from '../loadConfig.ts';
import type { ReleasePlan } from '../releasePlan.ts';
import { applyReleasePlan } from '../releasePlan.ts';
import { releasePrepareMono } from '../releasePrepareMono.ts';

/**
 * End-to-end project-release tests that:
 * - Create a real git repo in a temp directory.
 * - Seed it with three workspaces, an initial commit, a `v0.9.0` legacy tag, and a mix of
 *   `feat`/`fix` commits per workspace since.
 * - Run `releasePrepareMono` with a `project: {}` block declared in the config.
 * - Assert at the file-content level: project tag in result, root `package.json` bumped, root
 *   `CHANGELOG.md` regenerated with expected entries, project tag included alongside the
 *   per-workspace tags.
 *
 * `git-cliff` is invoked through `npx --yes`, so the test environment must have network
 * access to download git-cliff on first run (cached after).
 */

/**
 * Build a temp git repo with three workspaces (`pkg-a`, `pkg-b`, `pkg-c`), a legacy `v0.9.0`
 * tag at the initial commit, and three feat/fix commits since (one per workspace).
 */
function setupFixture(): TempTree {
  const tree = disposeOnTestFinished(createTempTree({}, { prefix: 'release-kit-project-' }));
  const run = (command: string, args: string[]): void => {
    execFileSync(command, args, { cwd: tree.dir, stdio: ['ignore', 'pipe', 'pipe'] });
  };

  // Initialize a clean repo with deterministic config so `git commit` does not require a
  // global identity to be set on the host.
  run('git', ['init', '--quiet', '--initial-branch=main']);
  run('git', ['config', 'user.email', 'test@example.com']);
  run('git', ['config', 'user.name', 'Test User']);
  run('git', ['config', 'commit.gpgsign', 'false']);
  run('git', ['config', 'tag.gpgSign', 'false']);

  // Root package.json (project block prerequisite).
  tree.writeJson('package.json', { name: 'fixture-monorepo', version: '0.9.0', private: true });

  // pnpm workspace declaration so `discoverWorkspaces` finds the three packages and the
  // CLI takes the monorepo branch rather than single-package mode.
  tree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");

  // Three workspaces.
  for (const name of ['pkg-a', 'pkg-b', 'pkg-c']) {
    tree.writeJson(`packages/${name}/package.json`, { name: `@fixture/${name}`, version: '1.0.0' });
    tree.write(`packages/${name}/index.ts`, `export const ${name.replace('-', '_')} = ${JSON.stringify(name)};\n`);
  }

  // Initial commit, then anchor the legacy v0.9.0 tag at it.
  run('git', ['add', '-A']);
  run('git', ['commit', '--quiet', '-m', 'chore: initial commit']);
  run('git', ['tag', 'v0.9.0']);
  // Per-workspace baselines so per-workspace `getCommitsSinceTarget` finds a tag.
  run('git', ['tag', 'pkg-a-v1.0.0']);
  run('git', ['tag', 'pkg-b-v1.0.0']);
  run('git', ['tag', 'pkg-c-v1.0.0']);

  // One feat per workspace plus one fix. The `##` synthetic ticket prefix is required by
  // the bundled cliff.toml.template's commit_parsers (any unticketed commit is skipped).
  for (const name of ['pkg-a', 'pkg-b']) {
    tree.write(`packages/${name}/feature.ts`, `export const flag = true;\n`);
    run('git', ['add', '-A']);
    run('git', ['commit', '--quiet', '-m', `## ${name}|feat: Add feature flag`]);
  }
  tree.write('packages/pkg-c/patch.ts', `export const patched = true;\n`);
  run('git', ['add', '-A']);
  run('git', ['commit', '--quiet', '-m', '## pkg-c|fix: Patch latent bug']);

  return tree;
}

/**
 * Switch CWD to the fixture repo for the duration of the closure. Restores the prior CWD
 * even if the closure throws — release-kit reads `process.cwd()` to resolve paths.
 */
function withinFixture<T>(repoDir: string, fn: () => T): T {
  using _cwd = pointCwdAt(repoDir, { chdir: true });

  return fn();
}

/** Compute the release plan and apply it, mirroring what the CLI boundary does. */
function prepareAndApply(...args: Parameters<typeof releasePrepareMono>): ReleasePlan {
  const plan = releasePrepareMono(...args);
  applyReleasePlan(plan);
  return plan;
}

describe('releasePrepareProject (tool)', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = setupFixture();
  });

  it('runs the project release alongside per-workspace releases and writes all artifacts', () => {
    withinFixture(tree.dir, () => {
      const config = mergeMonorepoConfig(
        ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
        { project: {}, changelogJson: { enabled: false } },
        { exists: true, version: '0.9.0' },
      );

      const result = prepareAndApply(config, {});

      // Project release happened.
      const project = result.project;
      assert(project?.status === 'released', 'expected released project');
      expect(project.previousTag).toBe('v0.9.0');
      // 2 feat + 1 fix → minor bump → 0.10.0 (pre-1.0 collapse not relevant since feat is minor).
      expect(project.releaseType).toBe('minor');
      expect(project.newVersion).toBe('0.10.0');
      expect(project.tag).toBe('v0.10.0');

      // Tags includes both the project tag and per-workspace tags.
      expect(result.tags).toContain('v0.10.0');
      expect(result.tags).toContain('pkg-a-v1.1.0');
      expect(result.tags).toContain('pkg-b-v1.1.0');
      expect(result.tags).toContain('pkg-c-v1.0.1');

      // Root package.json bumped to 0.10.0.
      const rootPackageJson: { version: string } = JSON.parse(readFileSync(join(tree.dir, 'package.json'), 'utf8'));
      expect(rootPackageJson.version).toBe('0.10.0');

      // Root CHANGELOG.md regenerated and contains the new version header. After the SSOT
      // pivot, `renderChangelogMarkdown` emits `## <version> — <date>` (no brackets, no
      // leading `v`).
      const rootChangelogPath = join(tree.dir, 'CHANGELOG.md');
      expect(existsSync(rootChangelogPath)).toBe(true);
      const rootChangelog = readFileSync(rootChangelogPath, 'utf8');
      expect(rootChangelog).toMatch(/## 0\.10\.0 — \d{4}-\d{2}-\d{2}/);
      // Project-level changelog includes commits from every contributing workspace.
      expect(rootChangelog).toContain('Add feature flag');
      expect(rootChangelog).toContain('Patch latent bug');
      // The v0.9.0 baseline was set against a single unticketed `chore` commit that the
      // cliff parsers skip, so no entry is emitted for that release. After the SSOT pivot,
      // empty version entries are dropped (the old cliff template rendered them as empty
      // headings). Only the new release's heading appears.
    });
  }, 60_000);

  it('releases from root-level commits alone when project.paths covers the whole tree', () => {
    withinFixture(tree.dir, () => {
      const run = (command: string, args: string[]): void => {
        execFileSync(command, args, { cwd: tree.dir, stdio: ['ignore', 'pipe', 'pipe'] });
      };

      // Anchor a project baseline past the fixture's workspace commits, so the only commit in
      // the window is the root-level one landed below. The `release:` prefix keeps this commit
      // out of the window itself.
      tree.writeJson('package.json', { name: 'fixture-monorepo', version: '0.9.1', private: true });
      run('git', ['add', '-A']);
      run('git', ['commit', '--quiet', '-m', 'release: v0.9.1']);
      run('git', ['tag', 'v0.9.1']);

      tree.write('aws/runbook.md', '# Runbook\n');
      run('git', ['add', '-A']);
      run('git', ['commit', '--quiet', '-m', '## root|feat: Document the deployment runbook']);

      const discoveredPaths = ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'];
      const rootPackage = { exists: true, version: '0.9.1' };

      // Default window (the workspace union) sees nothing, so the project stage skips.
      const defaultConfig = mergeMonorepoConfig(
        discoveredPaths,
        { project: {}, changelogJson: { enabled: false } },
        rootPackage,
      );
      expect(releasePrepareMono(defaultConfig, {}).project?.status).toBe('skipped');

      // A whole-tree window sees the root commit and releases.
      const wholeTreeConfig = mergeMonorepoConfig(
        discoveredPaths,
        { project: { paths: ['**'] }, changelogJson: { enabled: false } },
        rootPackage,
      );
      const result = prepareAndApply(wholeTreeConfig, {});

      const project = result.project;
      assert(project?.status === 'released', 'expected released project');
      expect(project.previousTag).toBe('v0.9.1');
      expect(project.releaseType).toBe('minor');
      expect(project.tag).toBe('v0.10.0');

      const rootPackageJson: { version: string } = JSON.parse(readFileSync(join(tree.dir, 'package.json'), 'utf8'));
      expect(rootPackageJson.version).toBe('0.10.0');

      const rootChangelog = readFileSync(join(tree.dir, 'CHANGELOG.md'), 'utf8');
      expect(rootChangelog).toContain('Document the deployment runbook');
    });
  }, 60_000);

  it('overrides the project bump when --bump=major is supplied (1.x baseline)', () => {
    // Reset the fixture's root version to 1.x so the major bump is not collapsed by the
    // pre-1.0 rule in `bumpVersion`. The fixture's three feat/fix commits (created in
    // `setupFixture`) sit between this freshly-created `v1.0.0` baseline and HEAD when
    // we tag BEFORE the chore commit, so a natural minor bump is in scope and `--bump=major`
    // is exercised as a level chooser that overrides the natural bump.
    execFileSync('git', ['tag', 'v1.0.0', 'HEAD~3'], { cwd: tree.dir, stdio: ['ignore', 'pipe', 'pipe'] });
    tree.writeJson('package.json', { name: 'fixture-monorepo', version: '1.0.0', private: true });
    execFileSync('git', ['add', '-A'], { cwd: tree.dir, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['commit', '--quiet', '-m', 'chore: bump baseline'], {
      cwd: tree.dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    withinFixture(tree.dir, () => {
      const config = mergeMonorepoConfig(
        ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
        { project: {}, changelogJson: { enabled: false } },
        { exists: true, version: '1.0.0' },
      );

      const result = prepareAndApply(config, { bumpOverride: 'major' });

      const project = result.project;
      assert(project?.status === 'released', 'expected released project');
      expect(project.releaseType).toBe('major');
      expect(project.newVersion).toBe('2.0.0');
      expect(result.tags).toContain('v2.0.0');
    });
  }, 60_000);

  it('computes the project tag without writing, when the plan is not applied', () => {
    withinFixture(tree.dir, () => {
      const config = mergeMonorepoConfig(
        ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
        { project: {}, changelogJson: { enabled: false } },
        { exists: true, version: '0.9.0' },
      );

      const result = releasePrepareMono(config, {});

      const project = result.project;
      assert(project?.status === 'released', 'expected released project');
      expect(project.tag).toBe('v0.10.0');
      expect(result.tags).toContain('v0.10.0');

      // Planning alone writes nothing to disk.
      const rootPackageJson: { version: string } = JSON.parse(readFileSync(join(tree.dir, 'package.json'), 'utf8'));
      expect(rootPackageJson.version).toBe('0.9.0');
      expect(existsSync(join(tree.dir, 'CHANGELOG.md'))).toBe(false);
    });
  }, 60_000);

  it('overwrites an unparseable existing root changelog.json without warning (no-read at project stage)', () => {
    // No warning is possible: the stage renders from the cliff entries alone and never parses the existing file.
    withinFixture(tree.dir, () => {
      const changelogJsonPath = tree.write('.meta/changelog.json', '{this is not valid JSON');

      using silent = silenceConsole(['warn']);

      const config = mergeMonorepoConfig(
        ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
        { project: {} },
        { exists: true, version: '0.9.0' },
      );

      prepareAndApply(config, {});

      // No warning was emitted (the existing file was never parsed).
      const warnedAboutChangelogJson = silent.warn.mock.calls.some((call) =>
        call.some((arg) => typeof arg === 'string' && arg.includes('could not parse existing')),
      );
      expect(warnedAboutChangelogJson).toBe(false);

      // The file was overwritten with cliff-derived content (valid JSON).
      const written = readFileSync(changelogJsonPath, 'utf8');
      const parsed: Array<{ version: string }> = JSON.parse(written);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.some((entry) => entry.version === '0.10.0')).toBe(true);
    });
  }, 60_000);

  it('emits the project release-notes preview when --with-release-notes is set and changelogJson is enabled', () => {
    withinFixture(tree.dir, () => {
      const config = mergeMonorepoConfig(
        ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
        { project: {} },
        { exists: true, version: '0.9.0' },
      );

      prepareAndApply(config, { withReleaseNotes: true });

      // The project preview file lives at root docs/.
      const previewPath = join(tree.dir, 'docs', 'RELEASE_NOTES.v0.10.0.md');
      expect(existsSync(previewPath)).toBe(true);
      const preview = readFileSync(previewPath, 'utf8');
      expect(preview).toContain('Release notes — v0.10.0');
    });
  }, 60_000);

  it('writes a synthetic Notes / Forced version bump entry for empty-range project releases', () => {
    // Move the project baseline tag to HEAD so the project stage finds zero commits since.
    // Per-workspace baselines stay at the initial commit, so workspaces still release naturally
    // (we are testing the project stage's empty-range branch, not the workspace path).
    execFileSync('git', ['tag', '--delete', 'v0.9.0'], { cwd: tree.dir, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['tag', 'v0.9.0', 'HEAD'], { cwd: tree.dir, stdio: ['ignore', 'pipe', 'pipe'] });

    withinFixture(tree.dir, () => {
      const config = mergeMonorepoConfig(
        ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
        { project: {} },
        { exists: true, version: '0.9.0' },
      );

      const result = prepareAndApply(config, { force: true });

      // Project release proceeded under --force, choosing patch level (issue #369 fix).
      const project = result.project;
      assert(project?.status === 'released', 'expected released project');
      expect(project.previousTag).toBe('v0.9.0');
      expect(project.commits).toHaveLength(0);
      expect(project.releaseType).toBe('patch');
      expect(project.newVersion).toBe('0.9.1');

      // Root CHANGELOG.md is rendered by `renderChangelogMarkdown` after the SSOT pivot,
      // so it leads with the `# Changelog` header and the version heading appears below.
      const rootChangelogPath = join(tree.dir, 'CHANGELOG.md');
      expect(existsSync(rootChangelogPath)).toBe(true);
      const rootChangelog = readFileSync(rootChangelogPath, 'utf8');
      expect(rootChangelog).toMatch(/^# Changelog\n/);
      expect(rootChangelog).toMatch(/## 0\.9\.1 — \d{4}-\d{2}-\d{2}/);
      expect(rootChangelog).toContain('### Notes');
      expect(rootChangelog).toContain('- Forced version bump.');

      // Root .meta/changelog.json contains a corresponding canonical entry.
      const changelogJsonPath = join(tree.dir, '.meta', 'changelog.json');
      expect(existsSync(changelogJsonPath)).toBe(true);
      const parsed: Array<{
        version: string;
        sections: Array<{ title: string; audience: string; items: Array<{ description: string }> }>;
      }> = JSON.parse(readFileSync(changelogJsonPath, 'utf8'));
      const entry = parsed.find((e) => e.version === '0.9.1');
      expect(entry).toBeDefined();
      expect(entry?.sections[0]).toMatchObject({
        title: 'Notes',
        audience: 'dev',
        items: [{ description: 'Forced version bump.' }],
      });
    });
  }, 60_000);

  it('preserves prior changelog.json entries when an empty-range project release runs', () => {
    // Regression: the empty-range project branch must use upsert semantics. A plain
    // overwrite would erase prior structured history because the synthetic branch
    // produces only the new entry — git-cliff is not consulted to replay the full log.
    // Move the project baseline tag to HEAD so the project stage finds zero commits since,
    // forcing the empty-range branch.
    execFileSync('git', ['tag', '--delete', 'v0.9.0'], { cwd: tree.dir, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['tag', 'v0.9.0', 'HEAD'], { cwd: tree.dir, stdio: ['ignore', 'pipe', 'pipe'] });

    // Pre-seed the structured changelog with a prior entry that no current run could
    // reproduce. This entry must survive the empty-range release.
    const priorEntry = {
      version: '0.8.0',
      date: '2026-01-15',
      sections: [
        {
          title: 'Features',
          audience: 'consumer',
          items: [{ description: 'Historical entry that must not be lost.' }],
        },
      ],
    };
    const changelogJsonPath = tree.writeJson('.meta/changelog.json', [priorEntry]);

    withinFixture(tree.dir, () => {
      const config = mergeMonorepoConfig(
        ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
        { project: {} },
        { exists: true, version: '0.9.0' },
      );

      prepareAndApply(config, { force: true });

      const written: Array<{ version: string; sections: Array<{ items: Array<{ description: string }> }> }> =
        JSON.parse(readFileSync(changelogJsonPath, 'utf8'));

      // The prior entry survives.
      const survivedPrior = written.find((e) => e.version === '0.8.0');
      expect(survivedPrior).toBeDefined();
      expect(survivedPrior?.sections[0]?.items[0]?.description).toBe('Historical entry that must not be lost.');

      // The new synthetic entry is also present.
      const newEntry = written.find((e) => e.version === '0.9.1');
      expect(newEntry).toBeDefined();
      expect(newEntry?.sections[0]?.items[0]?.description).toBe('Forced version bump.');
    });
  }, 60_000);

  it('narrows to the named workspace via prepareCommand, leaving the project release unreleased', async () => {
    // Exercise the CLI entry point directly so the test reflects user-observable behavior
    // end-to-end: the named workspace releases, and the project tier is left alone. The
    // untouched root version and absent root CHANGELOG.md are what prove the skip.
    const { prepareCommand } = await import('../prepareCommand.ts');

    // Write a minimal release-kit config that declares the project block.
    tree.write('.config/release-kit.config.ts', 'export default { project: {} };\n');

    using _cwd = pointCwdAt(tree.dir, { chdir: true });
    using capture = captureStdio();
    const exit = throwOnProcessExit();
    using _silent = silenceConsole(['info']);

    try {
      await prepareCommand(['--only=pkg-a', '--no-git-checks']);
    } finally {
      exit[Symbol.dispose]();
    }

    expect(capture.stderr).not.toContain('cannot be combined with a project release');
    expect(capture.stdout).toContain('Project release skipped');

    // The project release did not run: the root version and root changelog are untouched.
    expect(existsSync(join(tree.dir, 'CHANGELOG.md'))).toBe(false);
    const rootPackageJson: { version: string } = JSON.parse(readFileSync(join(tree.dir, 'package.json'), 'utf8'));
    expect(rootPackageJson.version).toBe('0.9.0');

    // The named workspace did release.
    expect(existsSync(join(tree.dir, 'packages', 'pkg-a', 'CHANGELOG.md'))).toBe(true);
    const releaseTags = readFileSync(join(tree.dir, 'tmp', '.release-tags'), 'utf8');
    expect(releaseTags).toContain('pkg-a-v');
    expect(releaseTags).not.toMatch(/^v\d/m);
  }, 60_000);
});

describe('prepare atomicity (tool)', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = setupFixture();
  });

  it('leaves the working tree untouched when a workspace fails partway through preparation', () => {
    withinFixture(tree.dir, () => {
      expect(gitStatus(tree.dir)).toBe('');

      const config = mergeMonorepoConfig(
        ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
        { changelogJson: { enabled: false } },
        { exists: true, version: '0.9.0' },
      );

      // The last workspace declares a package file that does not exist, so its bump throws
      // during the execute phase — after the two workspaces before it have been planned.
      const lastWorkspace = config.workspaces.at(-1);
      assert(lastWorkspace !== undefined, 'expected a workspace to break');
      lastWorkspace.packageFiles = [...lastWorkspace.packageFiles, 'packages/pkg-c/missing.json'];

      expect(() => prepareAndApply(config, {})).toThrow('missing.json');
      expect(gitStatus(tree.dir)).toBe('');
    });
  }, 60_000);
});

/** Porcelain status of the fixture repo, trimmed; empty when the tree is clean. */
function gitStatus(repoDir: string): string {
  return execFileSync('git', ['status', '--porcelain'], {
    cwd: repoDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
