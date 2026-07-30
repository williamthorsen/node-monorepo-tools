import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveFormatTargets } from '../fmt.ts';

/**
 * Tracked fixture files. `packages/a` carries both kinds of ignore file, so one repository exercises
 * the gitignore hierarchy (which git applies during selection) and the prettierignore hierarchy
 * (which it cannot).
 */
const TRACKED_FILES = {
  'package.json': '{}\n',
  'root.js': 'const root = 1;\n',
  'packages/a/.gitignore': 'generated/\n',
  'packages/a/.prettierignore': 'protected.js\n',
  'packages/a/protected.js': 'const protectedValue = 1;\n',
  'packages/b/custom.prettierignore': 'nothing\n',
  'packages/b/ok.js': 'const ok = 1;\n',
};

describe(resolveFormatTargets, () => {
  let repository: string;

  beforeEach(() => {
    repository = scaffoldRepository(TRACKED_FILES);
  });

  afterEach(() => {
    fs.rmSync(repository, { recursive: true, force: true });
  });

  it('selects every tracked file, in a stable order', () => {
    const result = resolveFormatTargets(repository);

    expect(unwrap(result).files).toStrictEqual([
      'package.json',
      'packages/a/.gitignore',
      'packages/a/.prettierignore',
      'packages/a/protected.js',
      'packages/b/custom.prettierignore',
      'packages/b/ok.js',
      'root.js',
    ]);
  });

  it('selects an untracked file that git does not ignore', () => {
    writeFile(repository, 'packages/b/fresh.js', 'const fresh = 1;\n');

    const result = resolveFormatTargets(repository);

    expect(unwrap(result).files).toContain('packages/b/fresh.js');
  });

  it('omits a file ignored by a package-level .gitignore, from the repository root', () => {
    writeFile(repository, 'packages/a/generated/gen.js', 'const gen = 1;\n');

    const result = resolveFormatTargets(repository);

    expect(unwrap(result).files).not.toContain('packages/a/generated/gen.js');
  });

  it('omits it from inside the package too, so both working directories agree', () => {
    writeFile(repository, 'packages/a/generated/gen.js', 'const gen = 1;\n');

    const result = resolveFormatTargets(path.join(repository, 'packages', 'a'));

    expect(unwrap(result).files).not.toContain('generated/gen.js');
  });

  it('keeps a file matched by a package-level .prettierignore, leaving the exclusion to Prettier', () => {
    const result = resolveFormatTargets(repository);

    expect(unwrap(result).files).toContain('packages/a/protected.js');
    expect(unwrap(result).ignorePaths).toContain(path.join(repository, 'packages/a/.prettierignore'));
  });

  it('reports the repository-root .prettierignore first, even though the fixture has none', () => {
    const result = resolveFormatTargets(repository);

    expect(unwrap(result).ignorePaths[0]).toBe(path.join(repository, '.prettierignore'));
  });

  it('discovers .prettierignore files from the repository root when run inside a package', () => {
    const result = resolveFormatTargets(path.join(repository, 'packages', 'b'));

    expect(unwrap(result).ignorePaths).toStrictEqual([
      path.join(repository, '.prettierignore'),
      path.join(repository, 'packages/a/.prettierignore'),
    ]);
  });

  it('does not mistake a file merely ending in .prettierignore for an ignore file', () => {
    const result = resolveFormatTargets(repository);

    expect(unwrap(result).ignorePaths).not.toContain(path.join(repository, 'packages/b/custom.prettierignore'));
  });

  it('scopes the selection to the working directory', () => {
    const result = resolveFormatTargets(path.join(repository, 'packages', 'b'));

    expect(unwrap(result).files).toStrictEqual(['custom.prettierignore', 'ok.js']);
  });

  it('constrains the selection to the given pathspecs', () => {
    const result = resolveFormatTargets(repository, ['packages/b']);

    expect(unwrap(result).files).toStrictEqual(['packages/b/custom.prettierignore', 'packages/b/ok.js']);
  });

  it('fails rather than reporting an empty selection outside a git repository', () => {
    const outside = makeTempDir('nmr-fmt-bare-');
    writeFile(outside, 'stray.js', 'const stray = 1;\n');

    const result = resolveFormatTargets(outside);

    if (result.ok) throw new Error('expected resolution to fail outside a git repository');
    expect(result.error).toMatch(/not a git repository/);

    fs.rmSync(outside, { recursive: true, force: true });
  });
});

/**
 * Creates a git repository holding `files`, staged rather than committed: `--cached` reads the index,
 * so staging is enough and the fixture needs no commit identity.
 */
function scaffoldRepository(files: Record<string, string>): string {
  const dir = makeTempDir('nmr-fmt-');

  for (const [relativePath, contents] of Object.entries(files)) {
    writeFile(dir, relativePath, contents);
  }

  runGitOrThrow(['init', '--quiet'], dir);
  runGitOrThrow(['add', '--all'], dir);

  return dir;
}

/**
 * Creates a temp directory and resolves it through `realpath`, because macOS exposes the temp root
 * through a symlink while `git rev-parse --show-toplevel` reports the resolved path.
 */
function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return fs.realpathSync(dir);
}

function writeFile(dir: string, relativePath: string, contents: string): void {
  const filePath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function runGitOrThrow(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`fixture setup failed: \`git ${args.join(' ')}\` — ${result.stderr}`);
  }
}

/** Narrows a successful result, failing the test with git's own message when resolution did not succeed. */
function unwrap(result: ReturnType<typeof resolveFormatTargets>): { files: string[]; ignorePaths: string[] } {
  if (!result.ok) throw new Error(`expected resolution to succeed: ${result.error}`);
  return result.targets;
}
