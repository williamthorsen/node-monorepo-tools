import { chmodSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { runCli } from '../runCli.ts';
import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';
import { useMonorepo } from '../test-utils/useMonorepo.ts';

const PACKAGE_BIN = 'packages/a/node_modules/.bin/package-bin';
const ROOT_BIN = 'node_modules/.bin/root-bin';

describe('PATH of a command that nmr runs in place', () => {
  it('resolves bare-name binaries from the package bin and the root bin inside a package', async () => {
    const root = buildFixture();

    const { exitCode, stdout } = await runNmr('probe', path.join(root, 'packages/a'));

    expect(exitCode).toBe(0);
    expect(stdout).toContain('package-bin ran');
    expect(stdout).toContain('root-bin ran');
  });

  it('resolves a bare-name binary from the root bin at the root scope', async () => {
    const root = buildFixture();

    const { exitCode, stdout } = await runNmr('root-probe', root);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('root-bin ran');
  });
});

// region | Helpers
/** Builds a monorepo whose package and root each install a bin that prints its name, and returns its root. */
function buildFixture(): string {
  const root = useMonorepo({
    'package.json': JSON.stringify({ name: 'fixture-root', private: true, scripts: { 'root-probe': 'root-bin' } }),
    'packages/a/package.json': JSON.stringify({ name: 'a', scripts: { probe: 'package-bin && root-bin' } }),
    [PACKAGE_BIN]: '#!/bin/sh\necho package-bin ran\n',
    [ROOT_BIN]: '#!/bin/sh\necho root-bin ran\n',
  });
  chmodSync(path.join(root, PACKAGE_BIN), 0o755);
  chmodSync(path.join(root, ROOT_BIN), 0o755);
  return root;
}

/** Runs nmr in `cwd` with a PATH that contains neither fixture bin directory, returning its exit code and stdout. */
async function runNmr(command: string, cwd: string): Promise<{ exitCode: number; stdout: string }> {
  const stdoutChunks: Buffer[] = [];
  const stdout = new PassThrough();
  stdout.on('data', (chunk: Buffer) => {
    stdoutChunks.push(chunk);
  });

  const { exitCode } = await runCli({
    args: [command],
    cwd,
    env: { ...readAmbientEnv(), NMR_COMMAND_VERBOSITY: 'full', PATH: '/usr/bin:/bin' },
    stderr: new PassThrough(),
    stdout,
  });

  return { exitCode, stdout: Buffer.concat(stdoutChunks).toString('utf8') };
}
// endregion | Helpers
