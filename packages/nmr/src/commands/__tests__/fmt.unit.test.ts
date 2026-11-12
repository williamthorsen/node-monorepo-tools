import os from 'node:os';
import process from 'node:process';

import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect, it, vi } from 'vitest';

import { runFmt, runPrettier, type RunPrettierOptions } from '../fmt.ts';
import type { InheritedOutcome, SpawnInherited } from '../spawn-inherited.ts';

const CLI_PATH = '/prettier/bin.cjs';
const CWD = '/repo';

describe(runFmt, () => {
  it('rejects an NMR_NO_CACHE that is neither on nor off before reading any file', async () => {
    using captured = captureStdio();

    const exitCode = await runFmt(['--check'], CWD, { NMR_NO_CACHE: 'true' });

    expect(exitCode).toBe(2);
    expect(captured.stderr).toContain('NMR_NO_CACHE is `true`, which is not one of: 0, 1 (unset or empty is off)');
  });
});

describe(runPrettier, () => {
  it("runs the CLI under this process's Node in the given directory", () => {
    const spawn = createSpawn();

    runPrettier(buildOptions({ spawn }));

    expect(spawn).toHaveBeenCalledWith(process.execPath, expect.arrayContaining([CLI_PATH, 'a.js']), { cwd: CWD });
    expect(readArgs(spawn)[0]?.[0]).toBe(CLI_PATH);
  });

  it('leaves unparseable files to Prettier rather than filtering them out', () => {
    const spawn = createSpawn();

    runPrettier(buildOptions({ spawn }));

    expect(readArgs(spawn)[0]).toContain('--ignore-unknown');
  });

  it('passes one --ignore-path per discovered ignore file, root-most first', () => {
    const spawn = createSpawn();
    const ignorePaths = ['/repo/.prettierignore', '/repo/packages/a/.prettierignore'];

    runPrettier(buildOptions({ ignorePaths, spawn }));

    const args = readArgs(spawn)[0] ?? [];
    expect(args.filter((_, index) => args[index - 1] === '--ignore-path')).toStrictEqual(ignorePaths);
  });

  it('passes --config only when given a config path', () => {
    const spawn = createSpawn();

    runPrettier(buildOptions({ configPath: '/house/prettier.config.js', spawn }));
    runPrettier(buildOptions({ spawn }));

    const [withConfig = [], withoutConfig = []] = readArgs(spawn);
    expect(withConfig.slice(withConfig.indexOf('--config'), withConfig.indexOf('--config') + 2)).toStrictEqual([
      '--config',
      '/house/prettier.config.js',
    ]);
    expect(withoutConfig).not.toContain('--config');
  });

  it('checks without writing in check mode', () => {
    const spawn = createSpawn();

    runPrettier(buildOptions({ spawn }));

    const args = readArgs(spawn)[0] ?? [];
    expect(args).toContain('--check');
    expect(args).not.toContain('--write');
  });

  it('names the files that it rewrites in write mode', () => {
    const spawn = createSpawn();

    runPrettier(buildOptions({ mode: 'write', spawn }));

    expect(readArgs(spawn)[0]).toStrictEqual(expect.arrayContaining(['--list-different', '--write']));
  });

  it("passes Prettier's content-keyed cache when given a cache location", () => {
    const spawn = createSpawn();
    const cacheLocation = '/repo/node_modules/.cache/prettier/nmr-fmt/cache.json';

    runPrettier(buildOptions({ cacheLocation, spawn }));

    expect(readArgs(spawn)[0]).toStrictEqual(
      expect.arrayContaining(['--cache', '--cache-strategy', 'content', '--cache-location', cacheLocation]),
    );
  });

  it('passes no cache flags without a cache location', () => {
    const spawn = createSpawn();

    runPrettier(buildOptions({ spawn }));

    const args = readArgs(spawn)[0] ?? [];
    expect(args.filter((arg) => arg.startsWith('--cache'))).toStrictEqual([]);
  });

  it('shares one cache location across every batch', () => {
    const spawn = createSpawn();
    const cacheLocation = '/repo/cache.json';

    runPrettier(buildOptions({ budgetBytes: 10, cacheLocation, files: ['one.js', 'two.js'], spawn }));

    const locations = readArgs(spawn).map((args) => args[args.indexOf('--cache-location') + 1]);
    expect(locations).toStrictEqual([cacheLocation, cacheLocation]);
  });

  it('ends the options with -- ahead of the files in every batch', () => {
    const spawn = createSpawn();

    runPrettier(
      buildOptions({ budgetBytes: 10, files: ['one.js', 'two.js'], ignorePaths: ['/repo/.prettierignore'], spawn }),
    );

    expect(readArgs(spawn).map((args) => args.slice(args.indexOf('--')))).toStrictEqual([
      ['--', 'one.js'],
      ['--', 'two.js'],
    ]);
  });

  it('runs every batch when the selection exceeds the argument budget', () => {
    const spawn = createSpawn();

    // A ten-byte budget puts each of these paths in a batch of its own.
    runPrettier(buildOptions({ budgetBytes: 10, files: ['one.js', 'two.js', 'six.js'], spawn }));

    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it('keeps every file in one batch within the budget', () => {
    const spawn = createSpawn();

    runPrettier(buildOptions({ files: ['one.js', 'two.js', 'six.js'], spawn }));

    expect(readArgs(spawn).map((args) => args.slice(args.indexOf('--') + 1))).toStrictEqual([
      ['one.js', 'two.js', 'six.js'],
    ]);
  });

  it('reports the exit code that Prettier returned', () => {
    const spawn = createSpawn({ signal: null, status: 2 });

    expect(runPrettier(buildOptions({ spawn }))).toBe(2);
  });

  it('keeps running after a batch fails, and reports the first failing status', () => {
    const spawn = createSpawn();
    spawn.mockReturnValueOnce({ signal: null, status: 3 }).mockReturnValueOnce({ signal: null, status: 4 });

    const exitCode = runPrettier(buildOptions({ budgetBytes: 10, files: ['one.js', 'two.js'], spawn }));

    expect(exitCode).toBe(3);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('reports a Prettier killed by a signal as 128 plus the signal number', () => {
    const spawn = createSpawn({ signal: 'SIGKILL', status: null });

    expect(runPrettier(buildOptions({ spawn }))).toBe(128 + os.constants.signals.SIGKILL);
  });

  it('fails, naming the cause, when Prettier cannot be started, and runs no further batch', () => {
    using captured = captureStdio();
    const spawn = createSpawn({ error: new Error('spawn ENOENT'), signal: null, status: null });

    const exitCode = runPrettier(buildOptions({ budgetBytes: 10, files: ['one.js', 'two.js'], spawn }));

    expect(exitCode).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(captured.stderr).toContain('could not run `prettier` (spawn ENOENT).');
  });
});

// region | Helpers

/** Builds options for a check run over `a.js` without ignore files, overridden by `overrides`. */
function buildOptions(overrides: Partial<RunPrettierOptions>): RunPrettierOptions {
  return { cliPath: CLI_PATH, cwd: CWD, files: ['a.js'], ignorePaths: [], mode: 'check', ...overrides };
}

/** Creates a spawn fake that records each call and returns `outcome`, a clean exit by default. */
function createSpawn(outcome?: InheritedOutcome) {
  return vi.fn<SpawnInherited>(() => outcome ?? { signal: null, status: 0 });
}

/** Returns the argument list of each recorded spawn call, in order. */
function readArgs(spawn: ReturnType<typeof createSpawn>): string[][] {
  return spawn.mock.calls.map(([, args]) => [...args]);
}

// endregion | Helpers
