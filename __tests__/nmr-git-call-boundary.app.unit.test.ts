import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findMonorepoRoot } from '@williamthorsen/nmr/workspace';
import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

/** The source tree whose git calls go through nmr-core's `runGit`, relative to the monorepo root. */
const SCANNED_DIR = 'packages/nmr/src';

/**
 * The files that may run git themselves. `runHostSession` is sent to the host as source, so it cannot import
 * `runGit`; its caller passes it `GIT_OUTPUT_LIMIT_BYTES` instead.
 */
const ALLOWED_FILES = ['packages/nmr/src/remote-host-session.ts'];

/** A direct spawn of git, or a private git runner. */
const GIT_CALL_PATTERN =
  /\b(?:exec|execFile|execFileSync|execSync|spawn|spawnSync)\s*\(\s*["'`]git["'`]|\bfunction\s+runGit\b/;

/** Test code and fixture builders, whose git calls produce small output and may throw on failure. */
const PRUNED = new Set(['__tests__', 'test-utils']);

const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/;

const monorepoRoot = findMonorepoRoot(import.meta.dirname);

const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-git-call-boundary-' })),
);

/**
 * Guards nmr's buffered git calls: Each one goes through nmr-core's `runGit`, which applies
 * `GIT_OUTPUT_LIMIT_BYTES`, so that a large repository does not fail with ENOBUFS. The guard detects a spawn that
 * names git literally and a private `runGit`. Streaming runners such as `runProcess` and `runPhase` read into
 * bounded buffers, cannot fail with ENOBUFS, and are outside its concern.
 */
describe('the nmr git-call boundary', () => {
  it('leaves only the allowed files running git themselves', () => {
    expect(findGitCallers(monorepoRoot)).toStrictEqual(ALLOWED_FILES);
  });
});

describe(findGitCallers, () => {
  it.for([
    { name: 'a spawnSync of git', code: "spawnSync('git', ['status'], { cwd });\n" },
    { name: 'an execFileSync of git', code: 'childProcess.execFileSync("git", args);\n' },
    { name: 'a private runner', code: 'function runGit(args: string[]): void {}\n' },
  ])('reports $name', ({ code }, { tree }) => {
    tree.write(`${SCANNED_DIR}/commands/status.ts`, code);

    expect(findGitCallers(tree.dir)).toStrictEqual([`${SCANNED_DIR}/commands/status.ts`]);
  });

  it.for([...PRUNED])('ignores a git call under %s', (directory, { tree }) => {
    tree.write(`${SCANNED_DIR}/${directory}/initRepo.ts`, "execFileSync('git', ['init']);\n");

    expect(findGitCallers(tree.dir)).toStrictEqual([]);
  });

  it("ignores nmr-core's runGit and a spawn of another program", ({ tree }) => {
    tree.write(`${SCANNED_DIR}/commands/status.ts`, "runGit(['status'], cwd);\nspawnSync('gitleaks', []);\n");

    expect(findGitCallers(tree.dir)).toStrictEqual([]);
  });
});

// region | Helpers

/** Lists the scanned source files under `rootDir` that run git themselves, as sorted root-relative paths. */
function findGitCallers(rootDir: string): string[] {
  return listFiles(rootDir, SCANNED_DIR)
    .filter((file) => SOURCE_FILE_PATTERN.test(file))
    .filter((file) => GIT_CALL_PATTERN.test(readFileSync(path.join(rootDir, file), 'utf8')))
    .toSorted();
}

/** Walks `relativeDir` under `rootDir`, returning every file outside the pruned directories as a root-relative POSIX path. */
function listFiles(rootDir: string, relativeDir: string): string[] {
  return readdirSync(path.join(rootDir, relativeDir), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      return PRUNED.has(entry.name) ? [] : listFiles(rootDir, relativePath);
    }
    return entry.isFile() ? relativePath : [];
  });
}

// endregion | Helpers
