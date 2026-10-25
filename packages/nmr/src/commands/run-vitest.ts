import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import { reportError } from '@williamthorsen/nmr-core';
import { findMonorepoRoot as findMonorepoRootOrNothing } from '@williamthorsen/nmr-core/workspace';

import { describeSignalExitCode } from '../child-process.ts';
import { isObject } from '../helpers/type-guards.ts';
import { omitOutcomeFile } from '../stated-outcome.ts';

const VITEST_PACKAGE = 'vitest';

const SUPPORTED_VITEST_RANGE = '>=4.0.0 <6';

/** The extensions that Vitest tries for a config file, in its order. */
const CONFIG_EXTENSIONS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'];

/**
 * Runs the Vitest that `cwd` resolves, naming the monorepo root's config when the working directory does not have
 * one of its own, and returns the exit code to report.
 */
export function runNmrVitest(argv: string[], cwd: string = process.cwd()): number {
  const cli = resolveVitestCli(cwd);
  if (!cli.ok) {
    reportError(`nmr-vitest: ${cli.error}`);
    return 1;
  }

  // A test that runs an nmr bin in-process is not the step's bin, so the suite must not inherit the step's file.
  const result = spawnSync(process.execPath, [cli.cliPath, ...chooseVitestConfigArgs(argv, cwd)], {
    cwd,
    env: omitOutcomeFile(process.env),
    stdio: 'inherit',
  });

  if (result.error) {
    reportError(`nmr-vitest: could not run \`${VITEST_PACKAGE}\` (${result.error.message}).`);
    return 1;
  }

  if (result.signal !== null) return describeSignalExitCode(result.signal);
  return result.status ?? 1;
}

/**
 * Returns `argv` with `--config` naming the monorepo root's `vitest.config.*` prepended, or `argv` unchanged when
 * it already names a config, when `cwd` contains a Vitest or Vite config that Vitest loads itself, or when there is
 * no monorepo root config to name.
 *
 * Vitest 5 does not search parent directories for a config, so a package without its own would otherwise run
 * without the shared one.
 */
export function chooseVitestConfigArgs(argv: string[], cwd: string): string[] {
  if (namesConfig(argv)) return argv;
  if (findConfigFile(cwd, ['vitest.config', 'vite.config']) !== undefined) return argv;

  const monorepoRoot = findMonorepoRootOrNothing(cwd);
  if (monorepoRoot === undefined) return argv;

  const rootConfig = findConfigFile(monorepoRoot, ['vitest.config']);
  return rootConfig === undefined ? argv : ['--config', rootConfig, ...argv];
}

// region | Helpers

/** Returns the first config in `dir` matching one of `stems`, trying the stems in order and each one's extensions. */
function findConfigFile(dir: string, stems: string[]): string | undefined {
  for (const stem of stems) {
    for (const extension of CONFIG_EXTENSIONS) {
      const candidate = path.join(dir, `${stem}.${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Reports whether an argument ahead of any `--` names a config, which Vitest then loads instead of searching. */
function namesConfig(argv: string[]): boolean {
  for (const arg of argv) {
    if (arg === '--') return false;
    if (arg === '--config' || arg === '-c' || arg.startsWith('--config=')) return true;
  }
  return false;
}

/**
 * Locates the Vitest CLI that `cwd` resolves. nmr's own installation is never a fallback: A second copy of the runner
 * is not handed the state of the one that loads the tests.
 */
function resolveVitestCli(cwd: string): { ok: true; cliPath: string } | { ok: false; error: string } {
  const missingResult = {
    ok: false as const,
    error: `requires Vitest ${SUPPORTED_VITEST_RANGE}, but \`${VITEST_PACKAGE}\` could not be resolved from ${cwd}. Install a version in that range as the \`${VITEST_PACKAGE}\` peer dependency.`,
  };

  let manifestPath: string;
  try {
    manifestPath = createRequire(path.join(cwd, 'package.json')).resolve(`${VITEST_PACKAGE}/package.json`);
  } catch {
    return missingResult;
  }

  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bin = isObject(manifest) && isObject(manifest['bin']) ? manifest['bin'][VITEST_PACKAGE] : undefined;
  if (typeof bin !== 'string') {
    return { ok: false, error: `\`${VITEST_PACKAGE}\` at ${path.dirname(manifestPath)} does not declare a CLI.` };
  }

  return { ok: true, cliPath: path.resolve(path.dirname(manifestPath), bin) };
}

// endregion | Helpers
