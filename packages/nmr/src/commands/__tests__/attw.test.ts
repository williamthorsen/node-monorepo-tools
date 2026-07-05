import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { attwSpawnErrorMessage, buildAttwArgs, formatAttwResult, runAttw, type SpawnSyncFn } from '../attw.ts';

describe(buildAttwArgs, () => {
  it('appends the default profile when none is supplied', () => {
    expect(buildAttwArgs([])).toStrictEqual({ verbose: false, attwArgs: ['--profile', 'esm-only'] });
  });

  it('consumes --verbose without forwarding it', () => {
    expect(buildAttwArgs(['--verbose'])).toStrictEqual({ verbose: true, attwArgs: ['--profile', 'esm-only'] });
  });

  it('consumes -v without forwarding it', () => {
    expect(buildAttwArgs(['-v'])).toStrictEqual({ verbose: true, attwArgs: ['--profile', 'esm-only'] });
  });

  it('preserves a caller-supplied --profile', () => {
    expect(buildAttwArgs(['--profile', 'strict'])).toStrictEqual({ verbose: false, attwArgs: ['--profile', 'strict'] });
  });

  it('preserves a caller-supplied --profile= form', () => {
    expect(buildAttwArgs(['--profile=strict'])).toStrictEqual({ verbose: false, attwArgs: ['--profile=strict'] });
  });

  it('forwards unrelated args and appends the default profile', () => {
    expect(buildAttwArgs(['--ignore-rules', 'cjs-only-exports-default'])).toStrictEqual({
      verbose: false,
      attwArgs: ['--ignore-rules', 'cjs-only-exports-default', '--profile', 'esm-only'],
    });
  });
});

describe(formatAttwResult, () => {
  const base = {
    label: 'pkg',
    verbose: false,
    attwStatus: 0,
    attwStdout: 'TABLE',
    attwStderr: '',
  };

  it('prints a terse confirmation on success', () => {
    expect(formatAttwResult(base)).toStrictEqual({ status: 0, stdout: '✓ pkg: types OK\n', stderr: '' });
  });

  it('prints full output on a verbose success', () => {
    expect(formatAttwResult({ ...base, verbose: true })).toStrictEqual({ status: 0, stdout: 'TABLE', stderr: '' });
  });

  it('prints full diagnostics on failure', () => {
    expect(formatAttwResult({ ...base, attwStatus: 1, attwStderr: 'ERR' })).toStrictEqual({
      status: 1,
      stdout: 'TABLE',
      stderr: 'ERR',
    });
  });

  it('maps a null exit status to 1', () => {
    expect(formatAttwResult({ ...base, attwStatus: null, verbose: true }).status).toBe(1);
  });
});

describe(attwSpawnErrorMessage, () => {
  it('returns an install hint when attw is not found (ENOENT)', () => {
    expect(attwSpawnErrorMessage('pkg', makeMissingBinaryError('spawn attw ENOENT'))).toContain(
      'install @arethetypeswrong/cli',
    );
  });

  it('returns the underlying error for any other spawn failure', () => {
    expect(attwSpawnErrorMessage('pkg', new Error('boom'))).toContain('boom');
  });
});

describe(runAttw, () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nmr-attw-skip-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips a no-entry-point package without invoking attw or leaving a tarball', () => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'no-entry', version: '1.0.0' }));
    const stdout = new PassThrough();
    let out = '';
    stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });

    const exitCode = runAttw({ packageDir: dir, argv: [], stdout, stderr: new PassThrough(), env: process.env });

    expect(exitCode).toBe(0);
    expect(out).toContain('⛔ no-entry: No publishable entry point (no "main"/"exports"). Skipping attw.');
    expect(readdirSync(dir).some((file) => file.endsWith('.tgz'))).toBe(false);
  });

  it('surfaces the underlying error when npm pack fails to spawn', () => {
    writeEntryPackage(dir);

    const { exitCode, err } = runWithSpawn(
      dir,
      makeSpawnStub({ packError: makeMissingBinaryError('spawn npm ENOENT') }),
    );

    expect(exitCode).toBe(1);
    expect(err).toContain('spawn npm ENOENT');
  });

  it('forwards npm pack output on a non-zero pack exit', () => {
    writeEntryPackage(dir);

    const { exitCode, err } = runWithSpawn(dir, makeSpawnStub({ packStatus: 1 }));

    expect(exitCode).toBe(1);
    expect(err).toContain('npm ERR! pack failed');
  });

  it('reports when npm pack produces no tarball', () => {
    writeEntryPackage(dir);

    const { exitCode, err } = runWithSpawn(dir, makeSpawnStub({ writeTarball: false }));

    expect(exitCode).toBe(1);
    expect(err).toContain('produced no tarball');
  });

  it('emits the install hint when the attw binary is missing', () => {
    writeEntryPackage(dir);

    const { exitCode, err } = runWithSpawn(
      dir,
      makeSpawnStub({ attwError: makeMissingBinaryError('spawn attw ENOENT') }),
    );

    expect(exitCode).toBe(1);
    expect(err).toContain('install @arethetypeswrong/cli');
  });
});

// region | Helpers

/** Accumulates everything written to `stream` and returns a getter for the text captured so far. */
function collectStream(stream: PassThrough): () => string {
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
  });
  return () => buffer;
}

/** Builds an Error carrying `code: 'ENOENT'`, mimicking `spawnSync`'s result when a command binary can't be found. */
function makeMissingBinaryError(message: string): Error {
  return Object.assign(new Error(message), { code: 'ENOENT' });
}

/**
 * Builds a call-aware `spawnSync` stub that routes `npm` and `attw` invocations to canned results, so the wrapper's
 * subprocess-error branches run without a real subprocess. A successful `npm pack` writes a stand-in tarball into
 * `--pack-destination` so the flow reaches the attw step.
 */
function makeSpawnStub(config: {
  packError?: Error;
  packStatus?: number;
  writeTarball?: boolean;
  attwError?: Error;
  attwStatus?: number;
}): SpawnSyncFn {
  return (command, args) => {
    if (command === 'npm') {
      if (config.packError) return { error: config.packError, status: null, stdout: '', stderr: '' };
      const status = config.packStatus ?? 0;
      if (status === 0 && (config.writeTarball ?? true)) {
        const dest = args[args.indexOf('--pack-destination') + 1];
        if (dest !== undefined) writeFileSync(path.join(dest, 'pkg-1.0.0.tgz'), '');
      }
      return { status, stdout: '', stderr: status === 0 ? '' : 'npm ERR! pack failed' };
    }
    if (config.attwError) return { error: config.attwError, status: null, stdout: '', stderr: '' };
    return { status: config.attwStatus ?? 0, stdout: '', stderr: '' };
  };
}

/** Writes a minimal `package.json` declaring an `exports` entry point into `dir`, so `runAttw` clears the skip guard. */
function writeEntryPackage(dir: string): void {
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'p', version: '1.0.0', exports: { '.': './index.js' } }),
  );
}

/** Runs `runAttw` against `dir` with an injected `spawn`, capturing stderr; returns the exit code and error text. */
function runWithSpawn(dir: string, spawn: SpawnSyncFn): { exitCode: number; err: string } {
  const stderr = new PassThrough();
  const readErr = collectStream(stderr);
  const exitCode = runAttw({ packageDir: dir, argv: [], stdout: new PassThrough(), stderr, env: process.env, spawn });
  return { exitCode, err: readErr() };
}

// endregion | Helpers
