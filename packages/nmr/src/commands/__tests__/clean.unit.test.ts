import { chmodSync } from 'node:fs';
import path from 'node:path';

import { captureStdio, createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it as baseIt, vi } from 'vitest';

import { readCheckCacheEntry } from '../../check-cache-entries.ts';
import { OUTPUT_STYLE_ENV_VAR } from '../../output-style.ts';
import { cleanFrom, cleanPackage, runClean } from '../clean.ts';
import {
  cleanCollecting,
  hasOutput,
  recordCheckResult,
  resolveCacheEntry,
  resolveDurationEntry,
  scaffoldBuiltPackage,
  scaffoldWorkspace,
} from '../test-utils/clean-fixtures.ts';

const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-clean-' })),
);

describe(cleanPackage, () => {
  it('removes the build output', async ({ tree }) => {
    scaffoldBuiltPackage(tree, '.');

    await cleanPackage(tree.dir);

    expect(tree.exists('dist')).toBe(false);
  });

  it('removes the build cache, so the next build cannot skip on a stale digest', async ({ tree }) => {
    scaffoldBuiltPackage(tree, '.');

    await cleanPackage(tree.dir);

    expect(tree.exists(resolveCacheEntry(tree, '.'))).toBe(false);
  });

  it('removes the recorded emit duration along with the build cache', async ({ tree }) => {
    scaffoldBuiltPackage(tree, '.');

    await cleanPackage(tree.dir);

    expect(tree.exists(resolveDurationEntry(tree, '.'))).toBe(false);
  });

  it('leaves the sources intact', async ({ tree }) => {
    scaffoldBuiltPackage(tree, '.');

    await cleanPackage(tree.dir);

    expect(tree.exists('src/index.ts')).toBe(true);
    expect(tree.exists('package.json')).toBe(true);
  });

  it('is a no-op on a package that was never built', async ({ tree }) => {
    tree.writeAll({
      'node_modules/': '',
      'package.json': JSON.stringify({ name: 'fixture', type: 'module' }),
    });

    await expect(cleanPackage(tree.dir)).resolves.toBeUndefined();
  });
});

describe(runClean, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.for(['--help', '-h'])('answers %s with help and removes nothing', async (flag, { tree }) => {
    const { aDir } = scaffoldWorkspace(tree);
    await recordCheckResult(tree.dir, tree.dir, 'check');
    using captured = captureStdio();

    await expect(runClean([flag], tree.dir)).resolves.toBe(0);

    expect(captured.stdout).toContain('Usage: nmr-clean');
    expect(hasOutput(tree, aDir)).toBe(true);
    await expect(
      readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'check' }),
    ).resolves.toBeDefined();
  });

  it.for(['--bogus', '--output-style', 'packages'])(
    'rejects %s as a usage error and removes nothing',
    async (argument, { tree }) => {
      const { aDir } = scaffoldWorkspace(tree);
      await recordCheckResult(tree.dir, tree.dir, 'check');
      using captured = captureStdio();

      await expect(runClean([argument], tree.dir)).resolves.toBe(2);

      expect(captured.stderr).toContain("Try 'nmr-clean --help'.");
      expect(hasOutput(tree, aDir)).toBe(true);
      await expect(
        readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'check' }),
      ).resolves.toBeDefined();
    },
  );

  it('cleans when given no arguments', async ({ tree }) => {
    const { aDir } = scaffoldWorkspace(tree);
    using _captured = captureStdio({ includeConsole: true, isTty: false });

    await expect(runClean([], tree.dir)).resolves.toBe(0);

    expect(hasOutput(tree, aDir)).toBe(false);
  });

  it('prints the report of a one-package clean without a closing line', async ({ tree }) => {
    const { aDir } = scaffoldWorkspace(tree);
    // Pin the style, because an `nmr test` at a terminal exports the rich style, which outranks terminal detection.
    vi.stubEnv(OUTPUT_STYLE_ENV_VAR, 'plain');
    using captured = captureStdio({ includeConsole: true, isTty: false });

    await runClean([], tree.resolve(aDir));

    expect(captured.stdout).toBe('Removed all recorded check results.\na: Removed build output and cache.\n');
  });
});

describe(cleanFrom, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sweeps every workspace package when run from the monorepo root', async ({ tree }) => {
    const { aDir, bDir } = scaffoldWorkspace(tree);

    const { outcome } = await cleanCollecting(tree.dir);

    expect(outcome).toStrictEqual({
      kind: 'sweep',
      checkResultsDir: tree.dir,
      cleanedDirs: [tree.resolve(aDir), tree.resolve(bDir)],
      skippedCount: 0,
    });
    expect(hasOutput(tree, aDir)).toBe(false);
    expect(hasOutput(tree, bDir)).toBe(false);
  });

  it('reports each step as it completes, the check results first', async ({ tree }) => {
    const { aDir, bDir } = scaffoldWorkspace(tree);

    const { progress } = await cleanCollecting(tree.dir);

    expect(progress).toStrictEqual([
      { kind: 'check-results-removed' },
      { kind: 'package-cleaned', packageDir: tree.resolve(aDir) },
      { kind: 'package-cleaned', packageDir: tree.resolve(bDir) },
    ]);
  });

  it('cleans only the containing package when run from inside one', async ({ tree }) => {
    const { aDir, bDir } = scaffoldWorkspace(tree);

    const { outcome } = await cleanCollecting(tree.resolve(aDir));

    expect(outcome).toStrictEqual({ kind: 'package', checkResultsDir: tree.dir, packageDir: tree.resolve(aDir) });
    expect(hasOutput(tree, aDir)).toBe(false);
    expect(hasOutput(tree, bDir)).toBe(true);
  });

  it('cleans the current directory when it is not in a pnpm workspace', async ({ tree }) => {
    scaffoldBuiltPackage(tree, '.');

    const { outcome, progress } = await cleanCollecting(tree.dir);

    expect(outcome).toStrictEqual({ kind: 'package', checkResultsDir: tree.dir, packageDir: tree.dir });
    expect(progress).toStrictEqual([
      { kind: 'check-results-removed' },
      { kind: 'package-cleaned', packageDir: tree.dir },
    ]);
    expect(hasOutput(tree, '.')).toBe(false);
  });

  it('cleans the built-in in-process rather than spawning nmr-clean per package', async ({ tree }) => {
    // The stub fails if spawned, so a clean sweep proves that it was not.
    const { aDir, bDir } = scaffoldWorkspace(tree);
    tree.write('stub-bin/nmr-clean', '#!/bin/sh\nexit 7\n');
    chmodSync(tree.resolve('stub-bin/nmr-clean'), 0o755);
    vi.stubEnv('PATH', `${tree.resolve('stub-bin')}${path.delimiter}${process.env['PATH'] ?? ''}`);

    await cleanCollecting(tree.dir);

    expect(hasOutput(tree, aDir)).toBe(false);
    expect(hasOutput(tree, bDir)).toBe(false);
  });

  it('clears every recorded check result when run from the monorepo root', async ({ tree }) => {
    scaffoldWorkspace(tree);
    await recordCheckResult(tree.dir, tree.dir, 'ci');

    await cleanCollecting(tree.dir);

    await expect(
      readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci' }),
    ).resolves.toBeUndefined();
  });

  it('clears the whole table when run from inside one package', async ({ tree }) => {
    // `b` is the package that the invocation never enters, so its entry proves that the clearing is repo-wide.
    const { aDir, bDir } = scaffoldWorkspace(tree);
    await recordCheckResult(tree.dir, tree.resolve(aDir), 'check');
    await recordCheckResult(tree.dir, tree.resolve(bDir), 'check');

    await cleanCollecting(tree.resolve(aDir));

    await expect(
      readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.resolve(bDir), command: 'check' }),
    ).resolves.toBeUndefined();
  });

  it('clears the recorded check results of a package outside a workspace', async ({ tree }) => {
    scaffoldBuiltPackage(tree, '.');
    await recordCheckResult(tree.dir, tree.dir, 'check');

    await cleanCollecting(tree.dir);

    await expect(
      readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'check' }),
    ).resolves.toBeUndefined();
  });

  it('skips a package whose clean resolves to an empty command, and counts it', async ({ tree }) => {
    // An empty script is the package.json convention for "skip this command", so the sweep must leave the
    // output of a package that opted out of cleaning intact.
    const { aDir, bDir } = scaffoldWorkspace(tree);
    tree.write(`${aDir}/package.json`, JSON.stringify({ name: 'a', type: 'module', scripts: { clean: '' } }));

    const { outcome } = await cleanCollecting(tree.dir);

    expect(outcome).toMatchObject({ kind: 'sweep', cleanedDirs: [tree.resolve(bDir)], skippedCount: 1 });
    expect(hasOutput(tree, aDir)).toBe(true);
    expect(hasOutput(tree, bDir)).toBe(false);
  });
});
