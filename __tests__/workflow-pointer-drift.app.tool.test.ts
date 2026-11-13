import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { createGitAdapter } from '../scripts/check-workflow-pointer-drift.ts';

const AUDIT_PATH = '.github/workflows/audit.reusable.yaml';
const AUDIT_TAG = 'workflow/audit-v1';
const SCRIPT_PATH = path.join(import.meta.dirname, '..', 'scripts', 'check-workflow-pointer-drift.ts');

/** The fixture repository and the SHAs of its commits that touch the audit workflow. */
interface DriftRepo {
  firstSha: string;
  onceSha: string;
  tree: TempTree;
  twiceSha: string;
}

const it = baseIt
  // eslint-disable-next-line no-empty-pattern -- Vitest parses a fixture's first parameter and rejects anything but a destructuring pattern.
  .extend('repo', { scope: 'file' }, ({}, { onCleanup }): DriftRepo => {
    using stack = new DisposableStack();
    const tree = stack.use(createTempTree({}, { prefix: 'pointer-drift-' }));
    const repo = buildDriftRepo(tree);

    const ownedStack = stack.move();
    onCleanup(() => {
      ownedStack.dispose();
    });

    return repo;
  })
  .extend(
    'tree',
    makeFixture(() => createTempTree({}, { prefix: 'pointer-drift-summary-' })),
  );

describe(createGitAdapter, () => {
  it('lists the tags under `workflow/` by short name, ignoring tags outside that namespace', ({ repo }) => {
    expect(createGitAdapter(repo.tree.dir).listPointerTags()).toStrictEqual([AUDIT_TAG]);
  });

  it('reports whether a file exists in the tree of a ref', ({ repo }) => {
    const git = createGitAdapter(repo.tree.dir);

    expect(git.isPresentAt('main', AUDIT_PATH)).toBe(true);
    expect(git.isPresentAt('main', '.github/workflows/absent.reusable.yaml')).toBe(false);
  });

  it('lists the selected commits that touch a file newest first, as `<short sha> <subject>`', ({ repo }) => {
    const git = createGitAdapter(repo.tree.dir);

    expect(git.listCommitsTouching(['main', `^${AUDIT_TAG}`], AUDIT_PATH)).toStrictEqual([
      `${shortSha(repo, repo.twiceSha)} Change audit twice`,
      `${shortSha(repo, repo.onceSha)} Change audit once`,
    ]);
    expect(git.listCommitsTouching(['main', `^${AUDIT_TAG}`, `^${repo.onceSha}`], AUDIT_PATH)).toStrictEqual([
      `${shortSha(repo, repo.twiceSha)} Change audit twice`,
    ]);
    expect(git.listCommitsTouching(['main', '^main'], AUDIT_PATH)).toStrictEqual([]);
  });

  it('reports whether a revision names a commit, peeling an annotated tag', ({ repo }) => {
    const git = createGitAdapter(repo.tree.dir);

    expect(git.resolvesToCommit(repo.firstSha)).toBe(true);
    expect(git.resolvesToCommit(AUDIT_TAG)).toBe(true);
    expect(git.resolvesToCommit('deadbeef')).toBe(false);
  });
});

describe('the command', () => {
  it('fails on a drifted tag and an invalid holds file, and writes the report to stdout and the job summary', ({
    repo,
    tree,
  }) => {
    repo.tree.write('.config/workflow-pointer-holds.json', '[{ "tag": ');
    const summaryPath = path.join(tree.dir, 'summary.md');

    const result = spawnSync(process.execPath, [SCRIPT_PATH, 'main'], {
      cwd: repo.tree.dir,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('- ❌ `workflow/audit-v1` lacks 2 commit(s) that touch its workflow:');
    expect(result.stdout).toContain('- The holds file is not valid JSON: SyntaxError');
    expect(readFileSync(summaryPath, 'utf8')).toBe(result.stdout);
  });
});

// region | Helpers

/**
 * Builds a repository on `main` in which `workflow/audit-v1` (annotated) and a tag outside `workflow/` point to the
 * audit workflow's first commit, followed by two commits that touch the workflow and one that does not.
 */
function buildDriftRepo(tree: TempTree): DriftRepo {
  git(tree, ['init', '--initial-branch=main']);
  git(tree, ['config', 'user.email', 'fixture@example.com']);
  git(tree, ['config', 'user.name', 'Fixture']);
  git(tree, ['config', 'commit.gpgsign', 'false']);
  git(tree, ['config', 'tag.gpgsign', 'false']);

  const firstSha = commitFile(tree, AUDIT_PATH, 'first');
  git(tree, ['tag', '--annotate', AUDIT_TAG, '--message', AUDIT_TAG]);
  git(tree, ['tag', 'audit-workflow-v1']);
  const onceSha = commitFile(tree, AUDIT_PATH, 'second', 'Change audit once');
  const twiceSha = commitFile(tree, AUDIT_PATH, 'third', 'Change audit twice');
  commitFile(tree, 'README.md', 'unrelated');

  return { firstSha, onceSha, tree, twiceSha };
}

/** Writes `content` to `filePath`, commits it, and returns the commit's SHA. */
function commitFile(tree: TempTree, filePath: string, content: string, message = `Write ${filePath}`): string {
  tree.write(filePath, `${content}\n`);
  git(tree, ['add', '--all']);
  git(tree, ['commit', '--message', message]);
  return git(tree, ['rev-parse', 'HEAD']);
}

/** Runs git in the fixture and returns its trimmed stdout. */
function git(tree: TempTree, args: string[]): string {
  return execFileSync('git', args, { cwd: tree.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Returns the abbreviation that git uses for `sha` in the fixture repository. */
function shortSha(repo: DriftRepo, sha: string): string {
  return git(repo.tree, ['rev-parse', '--short', sha]);
}

// endregion | Helpers
