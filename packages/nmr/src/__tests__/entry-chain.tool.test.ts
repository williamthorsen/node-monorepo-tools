import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeAll, describe, expect, it } from 'vitest';

import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';

const CLI_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'esm', 'cli.js');

// Well inside the tier's 30-second budget, so that a run that re-enters without bound fails as a timeout rather than
// stalling the suite.
const SPAWN_TIMEOUT_MS = 15_000;

describe('a run that re-enters its own command', () => {
  // Warm the bin once, so that the chains of spawned nmr processes below start from a warm cache.
  beforeAll(() => {
    try {
      execSync(`node ${CLI_PATH} --help`, { env: readAmbientEnv(), stdio: 'ignore', timeout: 10_000 });
    } catch {
      // A cold cache only slows the tests down.
    }
  });

  it('fails, naming the root, when a workspace entry sends the command back to the root', () => {
    const tree = buildWorkspace({ config: { workspaceScripts: { build: ['-w build'] } } });

    const { status, stderr } = runBin(tree, ['build'], tree.dir);

    expect(status).not.toBe(0);
    expect(stderr).toContain('nmr re-entered `build` in root');
  });

  it('fails, naming the package, when its own entry filters the command back to itself', () => {
    const tree = buildWorkspace({ packageScripts: { build: 'nmr -F own-pkg build' } });

    const { status, stderr } = runBin(tree, ['build'], tree.resolve('packages/own-pkg'));

    expect(status).not.toBe(0);
    expect(stderr).toContain('nmr re-entered `build` in packages/own-pkg');
  });

  it('runs a fan-out whose packages wrap the command in a hook', () => {
    const tree = buildWorkspace({ config: { workspaceScripts: { build: 'true', 'build:pre': 'true' } } });

    const { status, stderr } = runBin(tree, ['build'], tree.dir);

    expect(stderr).not.toContain('re-entered');
    expect(status).toBe(0);
  });

  it('runs a composite that runs one command twice in sequence', () => {
    const tree = buildWorkspace({ config: { rootScripts: { probe: 'true', twice: ['probe', 'probe'] } } });

    const { status, stderr } = runBin(tree, ['twice'], tree.dir);

    expect(stderr).not.toContain('re-entered');
    expect(status).toBe(0);
  });
});

// region | Helpers

/**
 * Builds a workspace containing the package `own-pkg`, with an executable `nmr` on `bin/` that runs the built bin,
 * because a step leading with the `nmr` token spawns whatever `PATH` resolves.
 */
function buildWorkspace(options: {
  config?: Record<string, unknown>;
  packageScripts?: Record<string, string>;
}): TempTree {
  const { config, packageScripts } = options;

  const tree = disposeOnTestFinished(
    createTempTree(
      {
        'package.json': JSON.stringify({ name: 'fixture-root', private: true }),
        'packages/own-pkg/package.json': JSON.stringify({ name: 'own-pkg', scripts: packageScripts ?? {} }),
        'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
        ...(config !== undefined && { '.config/nmr.config.ts': `export default ${JSON.stringify(config)};\n` }),
      },
      { prefix: 'nmr-entry-chain-' },
    ),
  );

  const shim = tree.write('bin/nmr', `#!/bin/sh\nexec node ${CLI_PATH} "$@"\n`);
  // `node:fs`, because the tree's write does not take a mode and the shim has to be executable.
  fs.chmodSync(shim, 0o755);

  return tree;
}

/** Runs the built bin in `cwd`, with the workspace's shim first on `PATH`. */
function runBin(tree: TempTree, args: string[], cwd: string): { status: number | null; stderr: string } {
  const env = readAmbientEnv();
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...env, PATH: `${tree.resolve('bin')}${path.delimiter}${env['PATH'] ?? ''}` },
    timeout: SPAWN_TIMEOUT_MS,
  });

  return { status: result.status, stderr: result.stderr };
}

// endregion | Helpers
