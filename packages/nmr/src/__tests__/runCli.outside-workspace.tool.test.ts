import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import { initRepo } from '../test-utils/initRepo.ts';
import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';

const CLI_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'esm', 'cli.js');

// The bin directory that holds `nmr-fmt`, standing in for the one that `npx` or `pnpm dlx` puts on `PATH`.
const RUNNER_BIN_DIR = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'node_modules', '.bin');

const SPAWN_TIMEOUT_MS = 20_000;

const UNFORMATTED_SOURCE = 'const a  =1\n';

describe('nmr in a git repository without pnpm-workspace.yaml', () => {
  it('fails fmt:check, naming the file that git lists and Prettier would change', () => {
    const tree = buildPlainRepo();

    const { status, output } = runBin(tree, ['fmt:check']);

    expect(status).not.toBe(0);
    expect(output).toContain('a.js');
  });

  it('formats the files that git lists under fmt', () => {
    const tree = buildPlainRepo();

    const { status } = runBin(tree, ['fmt']);

    expect(status).toBe(0);
    expect(tree.read('a.js')).toBe('const a = 1;\n');
  });

  it.for([{ command: 'build' }, { command: 'test' }])(
    'refuses $command, whose chain fans out to workspace packages, rather than passing over none',
    ({ command }) => {
      const tree = buildPlainRepo();

      const { status, output } = runBin(tree, [command]);

      expect(output).toContain(`\`${command}\` fans out to workspace packages, which needs a pnpm workspace`);
      expect(status).not.toBe(0);
    },
  );

  it('refuses a bin that reads the workspace, stating that the command needs one', () => {
    const tree = buildPlainRepo();

    const { status, output } = runBin(tree, ['upgrade']);

    expect(status).not.toBe(0);
    expect(output).toContain('needs a pnpm workspace');
  });
});

describe('nmr outside both a pnpm workspace and a git repository', () => {
  it('fails, naming both what it did not find', () => {
    const tree = disposeOnTestFinished(createTempTree({ 'a.js': UNFORMATTED_SOURCE }, { prefix: 'nmr-no-repo-' }));

    const { status, output } = runBin(tree, ['fmt:check']);

    expect(status).not.toBe(0);
    expect(output).toContain(`no pnpm-workspace.yaml in ${tree.dir} or any parent directory`);
    expect(output).toContain('is not inside a git repository');
  });
});

// region | Helpers

/**
 * Builds a committed git repository containing one unformatted file, without a workspace manifest or
 * `node_modules`.
 */
function buildPlainRepo(): TempTree {
  const tree = disposeOnTestFinished(createTempTree({ 'a.js': UNFORMATTED_SOURCE }, { prefix: 'nmr-plain-repo-' }));
  initRepo(tree.dir);

  return tree;
}

/** Runs the built bin at the repository root, with the runner's bin directory first on `PATH`. */
function runBin(tree: TempTree, args: string[]): { status: number | null; output: string } {
  const env = readAmbientEnv();
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd: tree.dir,
    encoding: 'utf8',
    env: { ...env, PATH: `${RUNNER_BIN_DIR}${path.delimiter}${env['PATH'] ?? ''}` },
    timeout: SPAWN_TIMEOUT_MS,
  });

  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// endregion | Helpers
