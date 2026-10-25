import path from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { runCli } from '../runCli.ts';
import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';

// The compile script runs the bin's source under Node's type stripping, as `prepare` does, so that the case
// observes this tree's bin rather than whichever build is installed.
const CLI_PATH = path.join(import.meta.dirname, '..', 'cli-build.ts');

const TSCONFIG = {
  compilerOptions: {
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    target: 'ES2022',
    allowImportingTsExtensions: true,
    declaration: true,
    strict: true,
  },
  include: ['src/'],
};

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-stated-outcome-' })),
);

describe('an outcome that a bin states through nmr', () => {
  // The fixture's real emit can take about a second, so whether the line names a saving depends on the machine.
  it('reports a build-cache hit on the quiet verdict line of the compile that hit it', async ({ tree }) => {
    const packageDir = scaffoldMonorepo(tree);
    expect((await runNmr(['-q', 'compile'], packageDir)).exitCode).toBe(0);

    const { exitCode, stdout } = await runNmr(['-q', 'compile'], packageDir);

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('No changes detected');
    expect(stdout).toMatch(/^PASS a: compile: passed in \S+ — build skipped as unchanged(?:, saved ~\S+)?$/mu);
  });

  it('serializes the stated outcome under --json', async ({ tree }) => {
    const packageDir = scaffoldMonorepo(tree);
    await runNmr(['-q', 'compile'], packageDir);

    const { stdout } = await runNmr(['--json', '-q', 'compile'], packageDir);

    expect(parseRecords(stdout)).toContainEqual(
      expect.objectContaining({
        command: 'compile',
        outcome: 'passed',
        stated: expect.objectContaining({ kind: 'build-unchanged' }),
      }),
    );
  });

  it('reports a compile that emitted without any detail', async ({ tree }) => {
    const packageDir = scaffoldMonorepo(tree);

    const { stdout } = await runNmr(['-q', 'compile'], packageDir);

    expect(stdout).toMatch(/^PASS a: compile: passed in \S+$/mu);
  });

  it('reports a command that does not state an outcome as it always has', async ({ tree }) => {
    const packageDir = scaffoldMonorepo(tree);

    const { stdout } = await runNmr(['-q', 'other'], packageDir);

    expect(stdout).toMatch(/^PASS a: other: passed in \S+$/mu);
  });
});

// region | Helpers

/** Parses each JSON line of a run's stdout. */
function parseRecords(stdout: string): unknown[] {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line): unknown => JSON.parse(line));
}

/**
 * Runs the CLI in-process against `cwd`, returning what it and every process below it wrote to stdout. The ambient
 * environment has nmr's own variables stripped from it.
 */
async function runNmr(args: string[], cwd: string): Promise<{ exitCode: number; stdout: string }> {
  const chunks: Buffer[] = [];
  const stdout = new PassThrough();
  stdout.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  const { exitCode } = await runCli({ args, cwd, env: readAmbientEnv(), stderr: new PassThrough(), stdout });

  return { exitCode, stdout: Buffer.concat(chunks).toString('utf8') };
}

/**
 * Writes a monorepo with one compilable package, `a`, whose `compile` runs the bin's source and whose `other` stands
 * for a third-party command. Returns the package's directory, from which each case runs nmr.
 */
function scaffoldMonorepo(tree: TempTree): string {
  tree.writeAll({
    '.config/nmr.config.ts': `export default ${JSON.stringify({
      workspaceScripts: { compile: `"${process.execPath}" "${CLI_PATH}"`, other: 'echo ok' },
    })};\n`,
    'node_modules/': '',
    'packages/a/node_modules/': '',
    'packages/a/src/index.ts': 'export const value = 1;\n',
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
  });
  tree.writeJson('package.json', { name: 'stated-outcome-root', private: true });
  tree.writeJson('packages/a/package.json', { name: 'a', type: 'module' });
  tree.writeJson('packages/a/tsconfig.json', TSCONFIG);

  return tree.resolve('packages/a');
}

// endregion | Helpers
