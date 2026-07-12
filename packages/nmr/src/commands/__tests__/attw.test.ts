import { mkdtempSync, readdirSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PackedTarball } from '../../helpers/tarball.ts';
import {
  attwSpawnErrorMessage,
  buildAttwArgs,
  checkTypeClaim,
  formatAttwResult,
  runAttw,
  type SpawnSyncFn,
} from '../attw.ts';

describe(buildAttwArgs, () => {
  it('appends the default profile and requests JSON when nothing is supplied', () => {
    expect(buildAttwArgs([])).toStrictEqual({
      passthrough: false,
      profile: 'esm-only',
      attwArgs: ['--profile', 'esm-only', '--format', 'json'],
    });
  });

  it('consumes --verbose without forwarding it and omits --format json', () => {
    expect(buildAttwArgs(['--verbose'])).toStrictEqual({
      passthrough: true,
      profile: 'esm-only',
      attwArgs: ['--profile', 'esm-only'],
    });
  });

  it('consumes -v without forwarding it and omits --format json', () => {
    expect(buildAttwArgs(['-v'])).toStrictEqual({
      passthrough: true,
      profile: 'esm-only',
      attwArgs: ['--profile', 'esm-only'],
    });
  });

  it('preserves a caller-supplied --profile and reports it', () => {
    expect(buildAttwArgs(['--profile', 'strict'])).toStrictEqual({
      passthrough: false,
      profile: 'strict',
      attwArgs: ['--profile', 'strict', '--format', 'json'],
    });
  });

  it('preserves a caller-supplied --profile= form and reports it', () => {
    expect(buildAttwArgs(['--profile=strict'])).toStrictEqual({
      passthrough: false,
      profile: 'strict',
      attwArgs: ['--profile=strict', '--format', 'json'],
    });
  });

  it('honors a caller-supplied --format instead of overriding it, and passes attw output through', () => {
    expect(buildAttwArgs(['--format', 'table'])).toStrictEqual({
      passthrough: true,
      profile: 'esm-only',
      attwArgs: ['--format', 'table', '--profile', 'esm-only'],
    });
  });

  it('honors a caller-supplied --format= form', () => {
    expect(buildAttwArgs(['--format=table'])).toStrictEqual({
      passthrough: true,
      profile: 'esm-only',
      attwArgs: ['--format=table', '--profile', 'esm-only'],
    });
  });

  it('honors the -f short form of --format', () => {
    expect(buildAttwArgs(['-f', 'table'])).toStrictEqual({
      passthrough: true,
      profile: 'esm-only',
      attwArgs: ['-f', 'table', '--profile', 'esm-only'],
    });
  });

  it('forwards unrelated args and appends the default profile', () => {
    expect(buildAttwArgs(['--ignore-rules', 'cjs-only-exports-default'])).toStrictEqual({
      passthrough: false,
      profile: 'esm-only',
      attwArgs: ['--ignore-rules', 'cjs-only-exports-default', '--profile', 'esm-only', '--format', 'json'],
    });
  });
});

describe(formatAttwResult, () => {
  const base = {
    label: 'pkg',
    passthrough: false,
    attwStatus: 0,
    attwStdout: 'TABLE',
    attwStderr: '',
  };
  const esmOnlyIgnored = ['node10', 'node16-cjs'];

  it('prints a terse confirmation on success', () => {
    expect(formatAttwResult(base)).toStrictEqual({ status: 0, stdout: '✓ pkg: types OK\n', stderr: '' });
  });

  it('passes attw output through unchanged on a passthrough success', () => {
    expect(formatAttwResult({ ...base, passthrough: true })).toStrictEqual({ status: 0, stdout: 'TABLE', stderr: '' });
  });

  it('passes attw diagnostics through unchanged on a passthrough failure', () => {
    expect(formatAttwResult({ ...base, passthrough: true, attwStatus: 1, attwStderr: 'ERR' })).toStrictEqual({
      status: 1,
      stdout: 'TABLE',
      stderr: 'ERR',
    });
  });

  it('maps a null exit status to 1', () => {
    expect(formatAttwResult({ ...base, attwStatus: null, passthrough: true }).status).toBe(1);
  });

  it('renders a condensed verdict with a fix hint on a JSON failure', () => {
    const result = formatAttwResult({
      ...base,
      attwStatus: 1,
      attwStdout: attwJson([{ kind: 'FallbackCondition', entrypoint: '.', resolutionKind: 'node16-esm' }]),
      ignoredResolutions: esmOnlyIgnored,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('✗ pkg — types resolve via a fallback condition (1 entry point)');
    expect(result.stdout).toContain('Fix: in package.json "exports", put "types" before "import"');
    expect(result.stderr).toBe('');
  });

  it('points a mapped-kind verdict at --verbose for the diagnostics it discarded', () => {
    const result = formatAttwResult({
      ...base,
      attwStatus: 1,
      attwStdout: attwJson([{ kind: 'FallbackCondition', entrypoint: '.', resolutionKind: 'node16-esm' }]),
      ignoredResolutions: esmOnlyIgnored,
    });

    expect(result.stdout).toContain('Run `nmr attw --verbose`');
  });

  it('collapses a kind repeated across subpaths into an entry-point count', () => {
    const result = formatAttwResult({
      ...base,
      attwStatus: 1,
      attwStdout: attwJson([
        { kind: 'FallbackCondition', entrypoint: '.', resolutionKind: 'node16-esm' },
        { kind: 'FallbackCondition', entrypoint: './sub', resolutionKind: 'node16-esm' },
      ]),
      ignoredResolutions: esmOnlyIgnored,
    });

    expect(result.stdout).toContain('(2 entry points)');
  });

  it('drops problems on resolutions the profile ignores', () => {
    const result = formatAttwResult({
      ...base,
      attwStatus: 1,
      attwStdout: attwJson([
        { kind: 'FallbackCondition', entrypoint: '.', resolutionKind: 'node10' },
        { kind: 'FallbackCondition', entrypoint: './kept', resolutionKind: 'node16-esm' },
      ]),
      ignoredResolutions: esmOnlyIgnored,
    });

    expect(result.stdout).toContain('(1 entry point)');
  });

  it('falls back to an explicit failure notice when every problem is filtered out', () => {
    const result = formatAttwResult({
      ...base,
      attwStatus: 1,
      attwStdout: attwJson([{ kind: 'FallbackCondition', entrypoint: '.', resolutionKind: 'node10' }]),
      attwStderr: 'raw',
      ignoredResolutions: esmOnlyIgnored,
    });

    expect(result.stdout).toContain('✗ pkg: attw reported problems');
    expect(result.stdout).toContain('Run `nmr attw --verbose`');
    expect(result.stderr).toBe('raw');
  });

  it('falls back to an explicit failure notice when attw output is not JSON', () => {
    const result = formatAttwResult({ ...base, attwStatus: 1, attwStdout: 'not json', attwStderr: 'raw' });

    expect(result.stdout).toContain('✗ pkg: attw reported problems');
    expect(result.stderr).toBe('raw');
  });

  it('names the raw kind and omits the Fix line for an unmapped problem kind', () => {
    const result = formatAttwResult({
      ...base,
      attwStatus: 1,
      attwStdout: attwJson([{ kind: 'FalseCJS' }]),
      ignoredResolutions: esmOnlyIgnored,
    });

    expect(result.stdout).toContain('✗ pkg — FalseCJS (1 occurrence)');
    expect(result.stdout).not.toContain('Fix:');
    expect(result.stdout).toContain('Run `nmr attw --verbose`');
  });
});

describe(checkTypeClaim, () => {
  it('defers to attw when the tarball ships types', () => {
    const result = checkTypeClaim({ label: 'pkg', declaredPaths: ['./index.d.ts'], tarballHasTypes: true });

    expect(result).toBeUndefined();
  });

  it('defers to attw when the tarball ships types the package never declared', () => {
    const result = checkTypeClaim({ label: 'pkg', declaredPaths: [], tarballHasTypes: true });

    expect(result).toBeUndefined();
  });

  it('fails a package that declares types but ships none, naming the declared path', () => {
    const result = checkTypeClaim({ label: 'pkg', declaredPaths: ['./dist/index.d.ts'], tarballHasTypes: false });

    expect(result?.status).toBe(1);
    expect(result?.stdout).toContain('✗ pkg — declares types at "./dist/index.d.ts"');
    expect(result?.stdout).toContain('ships no type declarations');
    expect(result?.stdout).toContain('Fix: build the declarations before packing');
  });

  it('names every declared path when a package claims more than one', () => {
    const result = checkTypeClaim({
      label: 'pkg',
      declaredPaths: ['./dist/index.d.ts', './dist/sub.d.ts'],
      tarballHasTypes: false,
    });

    expect(result?.stdout).toContain('"./dist/index.d.ts", "./dist/sub.d.ts"');
  });

  it('omits the --verbose pointer, since a missing type surface leaves attw nothing to say', () => {
    const result = checkTypeClaim({ label: 'pkg', declaredPaths: ['./index.d.ts'], tarballHasTypes: false });

    expect(result?.stdout).not.toContain('--verbose');
  });

  it('reports an untyped package informationally rather than as types OK', () => {
    const result = checkTypeClaim({ label: 'pkg', declaredPaths: [], tarballHasTypes: false });

    expect(result?.status).toBe(0);
    expect(result?.stdout).toContain('ℹ pkg: Ships no type declarations, and declares none.');
    expect(result?.stdout).not.toContain('types OK');
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

  it('surfaces the underlying error when pnpm pack fails to spawn', () => {
    writeEntryPackage(dir);

    const { exitCode, err } = runWithSpawn(
      dir,
      makeSpawnStub({ packError: makeMissingBinaryError('spawn pnpm ENOENT') }),
    );

    expect(exitCode).toBe(1);
    expect(err).toContain('spawn pnpm ENOENT');
  });

  it('forwards pnpm pack output on a non-zero pack exit', () => {
    writeEntryPackage(dir);

    const { exitCode, err } = runWithSpawn(dir, makeSpawnStub({ packStatus: 1 }));

    expect(exitCode).toBe(1);
    expect(err).toContain('ERR_PNPM_PACK failed');
  });

  it('reports when pnpm pack produces no tarball', () => {
    writeEntryPackage(dir);

    const { exitCode, err } = runWithSpawn(dir, makeSpawnStub({ writeTarball: false }));

    expect(exitCode).toBe(1);
    expect(err).toContain('produced no tarball');
  });

  it('surfaces the reason when the packed tarball cannot be read', () => {
    writeEntryPackage(dir);

    const { exitCode, err } = runWithSpawn(dir, makeSpawnStub({}), () => {
      throw new Error('Could not read tarball /tmp/x.tgz: incorrect header check');
    });

    expect(exitCode).toBe(1);
    expect(err).toContain('incorrect header check');
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

  it('reads attw output from the file it redirected stdout to, not from the captured pipe', () => {
    writeEntryPackage(dir);

    const { exitCode, out } = runWithSpawn(
      dir,
      makeSpawnStub({
        attwStatus: 1,
        attwStdout: attwJson([{ kind: 'FallbackCondition', entrypoint: '.', resolutionKind: 'node16-esm' }]),
      }),
    );

    expect(exitCode).toBe(1);
    expect(out).toContain('✗ p — types resolve via a fallback condition (1 entry point)');
  });

  it('fails a package whose packed manifest declares types the tarball does not ship, without running attw', () => {
    writeEntryPackage(dir);
    let attwRan = false;
    const spawn: SpawnSyncFn = (command, args, options) => {
      if (command !== 'pnpm') attwRan = true;
      return makeSpawnStub({})(command, args, options);
    };

    const { exitCode, out } = runWithSpawn(dir, spawn, () => packedTarball(['index.js'], { types: './index.d.ts' }));

    expect(exitCode).toBe(1);
    expect(out).toContain('✗ p — declares types at "./index.d.ts"');
    expect(attwRan).toBe(false);
  });

  it('reads the type claim from the packed manifest, not the source package.json', () => {
    // The source declares no types; the packed manifest does, as a `publishConfig` rewrite would leave it.
    writeEntryPackage(dir);

    const { exitCode, out } = runWithSpawn(dir, makeSpawnStub({}), () =>
      packedTarball(['index.js'], { exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } } }),
    );

    expect(exitCode).toBe(1);
    expect(out).toContain('✗ p — declares types at "./dist/index.d.ts"');
  });

  it('reports an untyped package informationally without running attw', () => {
    writeEntryPackage(dir);
    let attwRan = false;
    const spawn: SpawnSyncFn = (command, args, options) => {
      if (command !== 'pnpm') attwRan = true;
      return makeSpawnStub({})(command, args, options);
    };

    const { exitCode, out } = runWithSpawn(dir, spawn, () => packedTarball(['index.js'], {}));

    expect(exitCode).toBe(0);
    expect(out).toContain('ℹ p: Ships no type declarations, and declares none.');
    expect(attwRan).toBe(false);
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

/** Serializes a minimal attw `--format json` payload carrying just the problems the wrapper reads. */
function attwJson(problems: Array<{ kind: string; entrypoint?: string; resolutionKind?: string }>): string {
  return JSON.stringify({ analysis: { problems } });
}

/**
 * Builds a call-aware `spawnSync` stub that routes `pnpm` and `attw` invocations to canned results, so the wrapper's
 * subprocess-error branches run without a real subprocess. A successful `pnpm pack` writes a stand-in tarball into
 * `--pack-destination` so the flow reaches the attw step, and the attw call writes `attwStdout` to the file descriptor
 * the wrapper supplied — the same channel the real attw writes to.
 */
function makeSpawnStub(config: {
  packError?: Error;
  packStatus?: number;
  writeTarball?: boolean;
  attwError?: Error;
  attwStatus?: number;
  attwStdout?: string;
}): SpawnSyncFn {
  return (command, args, options) => {
    if (command === 'pnpm') {
      if (config.packError) return { error: config.packError, status: null, stderr: '' };
      const status = config.packStatus ?? 0;
      if (status === 0 && (config.writeTarball ?? true)) {
        const dest = args[args.indexOf('--pack-destination') + 1];
        if (dest !== undefined) writeFileSync(path.join(dest, 'pkg-1.0.0.tgz'), '');
      }
      return { status, stderr: status === 0 ? '' : 'ERR_PNPM_PACK failed' };
    }
    if (config.attwError) return { error: config.attwError, status: null, stderr: '' };
    const fd = options.stdio?.[1];
    if (fd !== undefined && config.attwStdout !== undefined) writeSync(fd, config.attwStdout);
    return { status: config.attwStatus ?? 0, stderr: '' };
  };
}

/**
 * Builds the reader's view of a packed tarball. The stubbed `pnpm pack` writes a placeholder `.tgz` that is
 * never decoded, so the tests state the packed contents directly — the real decoding is covered by
 * `tarball.int.test.ts` against tarballs `pnpm pack` actually produced.
 */
function packedTarball(files: string[], packageJson: PackedTarball['packageJson']): PackedTarball {
  return { files: ['package.json', ...files], packageJson: { name: 'p', version: '1.0.0', ...packageJson } };
}

/** A packed tarball shipping declarations, so `runAttw` passes the type-claim check and reaches attw. */
function typedTarball(): PackedTarball {
  return packedTarball(['index.js', 'index.d.ts'], {
    exports: { '.': { types: './index.d.ts', default: './index.js' } },
  });
}

/** Writes a minimal `package.json` declaring an `exports` entry point into `dir`, so `runAttw` clears the skip guard. */
function writeEntryPackage(dir: string): void {
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'p', version: '1.0.0', exports: { '.': './index.js' } }),
  );
}

/**
 * Runs `runAttw` against `dir` with an injected `spawn` and tarball reader; returns the exit code and the
 * captured streams. The reader defaults to a typed tarball, so a test that says nothing about types reaches attw.
 */
function runWithSpawn(
  dir: string,
  spawn: SpawnSyncFn,
  readTarball: () => PackedTarball = typedTarball,
): { exitCode: number; out: string; err: string } {
  const stdout = new PassThrough();
  const readOut = collectStream(stdout);
  const stderr = new PassThrough();
  const readErr = collectStream(stderr);
  const exitCode = runAttw({ packageDir: dir, argv: [], stdout, stderr, env: process.env, spawn, readTarball });
  return { exitCode, out: readOut(), err: readErr() };
}

// endregion | Helpers
