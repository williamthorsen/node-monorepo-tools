import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

/** One shim stands for all of them, which the bin-shim-bodies test holds to the same body. */
const SHIM_SOURCE = readFileSync(
  path.join(import.meta.dirname, '..', 'packages', 'v11y-check', 'bin', 'v11y.js'),
  'utf8',
);

const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({ 'bin/v11y.js': SHIM_SOURCE, 'package.json': '{ "type": "module" }\n' })),
);

describe('a bin shim whose build entry throws', () => {
  it('reports an error as an internal error, followed by its stack frames', ({ tree }) => {
    tree.write('dist/esm/cli.js', "throw new TypeError('cannot read x');\n");

    const result = runShim(tree);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^v11y: internal error: cannot read x\n {4}at .*cli\.js/);
  });

  it('reports a thrown non-Error by its string form, without frames', ({ tree }) => {
    tree.write('dist/esm/cli.js', "throw 'just a string';\n");

    const result = runShim(tree);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('v11y: internal error: just a string\n');
  });

  it('reports a thrown null without failing in the handler', ({ tree }) => {
    tree.write('dist/esm/cli.js', 'throw null;\n');

    const result = runShim(tree);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('v11y: internal error: null\n');
  });

  it('reports missing build output with the bootstrap hint', ({ tree }) => {
    const result = runShim(tree);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('v11y: build output not found; run `nmr build` first\n');
  });
});

// region | Helpers

/** Runs the tree's shim under `node` with piped stdio, returning its exit status and stderr. */
function runShim(tree: TempTree): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [tree.resolve('bin', 'v11y.js')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: result.status, stderr: result.stderr };
}

// endregion | Helpers
