import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeMonorepoConfig } from '../loadConfig.ts';
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

interface Fixture {
  repoDir: string;
  cleanup: () => void;
}

/**
 * Build a temp git repo with three workspaces (`pkg-a`, `pkg-b`, `pkg-c`), a legacy `v0.9.0`
 * tag at the initial commit, and three feat/fix commits since (one per workspace).
 */
function setupFixture(): Fixture {
  const repoDir = mkdtempSync(join(tmpdir(), 'release-kit-project-'));
  const run = (command: string, args: string[]): void => {
    execFileSync(command, args, { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
  };

  // Initialize a clean repo with deterministic config so `git commit` does not require a
  // global identity to be set on the host.
  run('git', ['init', '--quiet', '--initial-branch=main']);
  run('git', ['config', 'user.email', 'test@example.com']);
  run('git', ['config', 'user.name', 'Test User']);
  run('git', ['config', 'commit.gpgsign', 'false']);
  run('git', ['config', 'tag.gpgSign', 'false']);

  // Root package.json (project block prerequisite).
  writeFileSync(
    join(repoDir, 'package.json'),
    JSON.stringify({ name: 'fixture-monorepo', version: '0.9.0', private: true }, null, 2) + '\n',
    'utf8',
  );

  // pnpm workspace declaration so `discoverWorkspaces` finds the three packages and the
  // CLI takes the monorepo branch rather than single-package mode.
  writeFileSync(join(repoDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n", 'utf8');

  // Three workspaces.
  for (const name of ['pkg-a', 'pkg-b', 'pkg-c']) {
    const wsDir = join(repoDir, 'packages', name);
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(
      join(wsDir, 'package.json'),
      JSON.stringify({ name: `@fixture/${name}`, version: '1.0.0' }, null, 2) + '\n',
      'utf8',
    );
    writeFileSync(
      join(wsDir, 'index.ts'),
      `export const ${name.replace('-', '_')} = ${JSON.stringify(name)};\n`,
      'utf8',
    );
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
    writeFileSync(join(repoDir, 'packages', name, 'feature.ts'), `export const flag = true;\n`, 'utf8');
    run('git', ['add', '-A']);
    run('git', ['commit', '--quiet', '-m', `## ${name}|feat: Add feature flag`]);
  }
  writeFileSync(join(repoDir, 'packages', 'pkg-c', 'patch.ts'), `export const patched = true;\n`, 'utf8');
  run('git', ['add', '-A']);
  run('git', ['commit', '--quiet', '-m', '## pkg-c|fix: Patch latent bug']);

  return {
    repoDir,
    cleanup: () => rmSync(repoDir, { recursive: true, force: true }),
  };
}

/**
 * Switch CWD to the fixture repo for the duration of the closure. Restores the prior CWD
 * even if the closure throws — release-kit reads `process.cwd()` to resolve paths.
 */
function withinFixture<T>(repoDir: string, fn: () => T): T {
  const previous = process.cwd();
  process.chdir(repoDir);
  try {
    return fn();
  } finally {
    process.chdir(previous);
  }
}

describe('releasePrepareProject (integration)', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('runs the project release alongside per-workspace releases and writes all artifacts', () => {
    withinFixture(fixture.repoDir, () => {
      const config = mergeMonorepoConfig(
        ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
        { project: {}, changelogJson: { enabled: false } },
        { exists: true, version: '0.9.0' },
      );

      const result = releasePrepareMono(config, { dryRun: false });

      // Project release happened.
      const project = result.project;
      if (project?.status !== 'released') throw new Error('expected released project');
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
      const rootPackageJson: { version: string } = JSON.parse(
        readFileSync(join(fixture.repoDir, 'package.json'), 'utf8'),
      );
      expect(rootPackageJson.version).toBe('0.10.0');

      // Root CHANGELOG.md regenerated and contains the new version header. The bundled
      // cliff template strips the leading `v` from the version (`trim_start_matches`), so
      // the rendered heading is `## [0.10.0] - <date>` rather than `## [v0.10.0]`.
      const rootChangelogPath = join(fixture.repoDir, 'CHANGELOG.md');
      expect(existsSync(rootChangelogPath)).toBe(true);
      const rootChangelog = readFileSync(rootChangelogPath, 'utf8');
      expect(rootChangelog).toContain('## [0.10.0]');
      // Project-level changelog includes commits from every contributing workspace.
      expect(rootChangelog).toContain('Add feature flag');
      expect(rootChangelog).toContain('Patch latent bug');
      // The previous release is preserved in the regenerated file.
      expect(rootChangelog).toContain('## [0.9.0]');
    });
  }, 60_000);

  it('overrides the project bump when --bump=major is supplied (1.x baseline)', () => {
    // Reset the fixture's root version to 1.x so the major bump is not collapsed by the
    // pre-1.0 rule in `bumpVersion`. The fixture's three feat/fix commits (created in
    // `setupFixture`) sit between this freshly-created `v1.0.0` baseline and HEAD when
    // we tag BEFORE the chore commit, so a natural minor bump is in scope and `--bump=major`
    // is exercised as a level chooser that overrides the natural bump.
    execFileSync('git', ['tag', 'v1.0.0', 'HEAD~3'], { cwd: fixture.repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
    writeFileSync(
      join(fixture.repoDir, 'package.json'),
      JSON.stringify({ name: 'fixture-monorepo', version: '1.0.0', private: true }, null, 2) + '\n',
      'utf8',
    );
    execFileSync('git', ['add', '-A'], { cwd: fixture.repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['commit', '--quiet', '-m', 'chore: bump baseline'], {
      cwd: fixture.repoDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    withinFixture(fixture.repoDir, () => {
      const config = mergeMonorepoConfig(
        ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
        { project: {}, changelogJson: { enabled: false } },
        { exists: true, version: '1.0.0' },
      );

      const result = releasePrepareMono(config, { dryRun: false, bumpOverride: 'major' });

      const project = result.project;
      if (project?.status !== 'released') throw new Error('expected released project');
      expect(project.releaseType).toBe('major');
      expect(project.newVersion).toBe('2.0.0');
      expect(result.tags).toContain('v2.0.0');
    });
  }, 60_000);

  it('writes no files in --dry-run mode but still computes the project tag', () => {
    withinFixture(fixture.repoDir, () => {
      const config = mergeMonorepoConfig(
        ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
        { project: {}, changelogJson: { enabled: false } },
        { exists: true, version: '0.9.0' },
      );

      const result = releasePrepareMono(config, { dryRun: true });

      const project = result.project;
      if (project?.status !== 'released') throw new Error('expected released project');
      expect(project.tag).toBe('v0.10.0');
      expect(result.tags).toContain('v0.10.0');

      // Nothing was written to disk.
      const rootPackageJson: { version: string } = JSON.parse(
        readFileSync(join(fixture.repoDir, 'package.json'), 'utf8'),
      );
      expect(rootPackageJson.version).toBe('0.9.0');
      expect(existsSync(join(fixture.repoDir, 'CHANGELOG.md'))).toBe(false);
    });
  }, 60_000);

  it('overwrites an unparseable existing root changelog.json without warning (no-read at project stage)', () => {
    // Pin: the project stage no longer reads the existing root changelog.json. An unparseable
    // file is structurally bypassed — the soft `console.warn → return []` path inside
    // upsertChangelogJson cannot fire here because the project stage uses writeChangelogJson.
    withinFixture(fixture.repoDir, () => {
      const changelogJsonPath = join(fixture.repoDir, '.meta', 'changelog.json');
      mkdirSync(join(fixture.repoDir, '.meta'), { recursive: true });
      writeFileSync(changelogJsonPath, '{this is not valid JSON', 'utf8');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        const config = mergeMonorepoConfig(
          ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
          { project: {} },
          { exists: true, version: '0.9.0' },
        );

        releasePrepareMono(config, { dryRun: false });

        // No warning was emitted (the existing file was never parsed).
        const warnedAboutChangelogJson = warnSpy.mock.calls.some((call) =>
          call.some((arg) => typeof arg === 'string' && arg.includes('could not parse existing')),
        );
        expect(warnedAboutChangelogJson).toBe(false);

        // The file was overwritten with cliff-derived content (valid JSON).
        const written = readFileSync(changelogJsonPath, 'utf8');
        const parsed: Array<{ version: string }> = JSON.parse(written);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.some((entry) => entry.version === '0.10.0')).toBe(true);
      } finally {
        warnSpy.mockRestore();
      }
    });
  }, 60_000);

  it('emits the project release-notes preview when --with-release-notes is set and changelogJson is enabled', () => {
    withinFixture(fixture.repoDir, () => {
      const config = mergeMonorepoConfig(
        ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
        { project: {} },
        { exists: true, version: '0.9.0' },
      );

      releasePrepareMono(config, { dryRun: false, withReleaseNotes: true });

      // The project preview file lives at root docs/.
      const previewPath = join(fixture.repoDir, 'docs', 'RELEASE_NOTES.v0.10.0.md');
      expect(existsSync(previewPath)).toBe(true);
      const preview = readFileSync(previewPath, 'utf8');
      expect(preview).toContain('Release notes — v0.10.0');
    });
  }, 60_000);

  it('writes a synthetic Notes / Forced version bump entry for empty-range project releases', () => {
    // Move the project baseline tag to HEAD so the project stage finds zero commits since.
    // Per-workspace baselines stay at the initial commit, so workspaces still release naturally
    // (we are testing the project stage's empty-range branch, not the workspace path).
    execFileSync('git', ['tag', '--delete', 'v0.9.0'], { cwd: fixture.repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['tag', 'v0.9.0', 'HEAD'], { cwd: fixture.repoDir, stdio: ['ignore', 'pipe', 'pipe'] });

    withinFixture(fixture.repoDir, () => {
      const config = mergeMonorepoConfig(
        ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
        { project: {} },
        { exists: true, version: '0.9.0' },
      );

      const result = releasePrepareMono(config, { dryRun: false, force: true });

      // Project release proceeded under --force, choosing patch level (issue #369 fix).
      const project = result.project;
      if (project?.status !== 'released') throw new Error('expected released project');
      expect(project.previousTag).toBe('v0.9.0');
      expect(project.commits).toHaveLength(0);
      expect(project.releaseType).toBe('patch');
      expect(project.newVersion).toBe('0.9.1');

      // Root CHANGELOG.md contains the synthetic header at the top.
      const rootChangelogPath = join(fixture.repoDir, 'CHANGELOG.md');
      expect(existsSync(rootChangelogPath)).toBe(true);
      const rootChangelog = readFileSync(rootChangelogPath, 'utf8');
      expect(rootChangelog).toMatch(/^## 0\.9\.1 — \d{4}-\d{2}-\d{2}/);
      expect(rootChangelog).toContain('### Notes');
      expect(rootChangelog).toContain('- Forced version bump.');

      // Root .meta/changelog.json contains a corresponding canonical entry.
      const changelogJsonPath = join(fixture.repoDir, '.meta', 'changelog.json');
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
    execFileSync('git', ['tag', '--delete', 'v0.9.0'], { cwd: fixture.repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['tag', 'v0.9.0', 'HEAD'], { cwd: fixture.repoDir, stdio: ['ignore', 'pipe', 'pipe'] });

    // Pre-seed the structured changelog with a prior entry that no current run could
    // reproduce. This entry must survive the empty-range release.
    const changelogJsonPath = join(fixture.repoDir, '.meta', 'changelog.json');
    mkdirSync(join(fixture.repoDir, '.meta'), { recursive: true });
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
    writeFileSync(changelogJsonPath, JSON.stringify([priorEntry], null, 2) + '\n', 'utf8');

    withinFixture(fixture.repoDir, () => {
      const config = mergeMonorepoConfig(
        ['packages/pkg-a', 'packages/pkg-b', 'packages/pkg-c'],
        { project: {} },
        { exists: true, version: '0.9.0' },
      );

      releasePrepareMono(config, { dryRun: false, force: true });

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

  it('rejects --only via prepareCommand before any project work runs', async () => {
    // The CLI guard lives in prepareCommand. We exercise it directly so the integration test
    // reflects the user-observable behavior end-to-end. Failure must occur before any file is
    // written: assert no CHANGELOG.md, no bumped version, no project-tag artifact.
    const { prepareCommand } = await import('../prepareCommand.ts');
    let exitCode: number | undefined;
    const errors: string[] = [];

    // Write a minimal release-kit config that declares the project block.
    mkdirSync(join(fixture.repoDir, '.config'), { recursive: true });
    writeFileSync(
      join(fixture.repoDir, '.config', 'release-kit.config.ts'),
      'export default { project: {} };\n',
      'utf8',
    );

    const previousCwd = process.cwd();
    process.chdir(fixture.repoDir);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
      if (typeof msg === 'string') {
        errors.push(msg);
      }
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      exitCode = typeof code === 'number' ? code : undefined;
      throw new Error('process.exit');
    });

    try {
      await prepareCommand(['--only=pkg-a', '--no-git-checks']);
    } catch {
      // Expected: process.exit threw.
    } finally {
      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
      process.chdir(previousCwd);
    }

    expect(exitCode).toBe(1);
    expect(errors.some((m) => m.includes('--only cannot be combined with a project release'))).toBe(true);
    // No file was written.
    expect(existsSync(join(fixture.repoDir, 'CHANGELOG.md'))).toBe(false);
    const rootPackageJson: { version: string } = JSON.parse(
      readFileSync(join(fixture.repoDir, 'package.json'), 'utf8'),
    );
    expect(rootPackageJson.version).toBe('0.9.0');
  }, 60_000);
});
