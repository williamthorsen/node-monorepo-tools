import { rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { Writable } from 'node:stream';

import { UserError } from '@williamthorsen/nmr-core';
import { defineCommand, runCli } from '@williamthorsen/nmr-core/cli';

import { NMR_CLEAN_BIN } from '../bins.ts';
import { removeCheckCache } from '../check-cache/check-cache-entries.ts';
import { loadRootConfig } from '../config.ts';
import { findContainingPackageDir } from '../context.ts';
import { reportClosing } from '../helpers/reportClosing.ts';
import { resolveChannel } from '../output-channel.ts';
import { resolveBinStyles } from '../resolveBinStyles.ts';
import { buildWorkspaceRegistry, resolveScript } from '../resolver.ts';
import { runCommand } from '../runner.ts';
import { renderChain } from '../steps.ts';
import type { NmrConfig } from '../types.ts';
import { findMonorepoRoot, getWorkspacePackageDirs } from '../workspace.ts';
import { resolveBuildCachePath, resolveEmitDurationPath } from './build-output.ts';
import { renderCleanOutcome, renderCleanProgress } from './clean-report.ts';

/** The command name whose per-package resolution the root sweep honors. */
const CLEAN_COMMAND = 'clean';

/** The default `clean` script: this bin. A package resolving to it is cleaned in-process by the sweep. */
const BUILT_IN_CLEAN = 'nmr-clean';

/**
 * The build-output root removed by a clean. `nmr-compile` emits to `dist/esm`, a subdirectory of this
 * root, so removing the root removes the emit wherever `nmr-compile` writes it inside `dist`.
 */
const OUTPUT_ROOT = 'dist';

/** What a clean did: one package's clean, or a sweep of every workspace package. */
export type CleanOutcome =
  | { kind: 'package'; checkResultsDir: string; packageDir: string }
  | { kind: 'sweep'; checkResultsDir: string; cleanedDirs: string[]; skippedCount: number };

/** A step of a clean, reported as soon as it completes. */
export type CleanProgress = { kind: 'check-results-removed' } | { kind: 'package-cleaned'; packageDir: string };

/** What a clean needs from its caller: a listener for its progress, and the streams for an override's output. */
export interface CleanOptions {
  /** Called after each step completes, so that a caller can report it before a later override runs or fails. */
  onProgress?: (progress: CleanProgress) => void;
  /** The stream to which a package's own `clean` override writes its errors. */
  stderr: Writable;
  /** The stream to which a package's own `clean` override writes its output. */
  stdout: Writable;
}

/**
 * Cleans the package containing `cwd`, or every workspace package when run from the monorepo root.
 *
 * From within a package this is the built-in clean itself: `nmr` has already resolved `clean` to `nmr-clean`
 * before invoking it, so resolving again would apply the package's own override twice.
 */
export async function cleanFrom(cwd: string, options: CleanOptions): Promise<CleanOutcome> {
  let monorepoRoot: string;
  try {
    monorepoRoot = findMonorepoRoot(cwd);
  } catch {
    // Outside a pnpm workspace there is nothing to sweep; clean the package at `cwd`.
    await clearCheckCache(cwd, options);
    await cleanReportedPackage(cwd, options);
    return { kind: 'package', checkResultsDir: cwd, packageDir: cwd };
  }

  // Clear repo-wide, whatever scope the clean was invoked at: A check result records the tree on which it passed,
  // not the package in which it ran, so one package's entries are not separable from the rest.
  await clearCheckCache(monorepoRoot, options);

  const workspacePackageDirs = getWorkspacePackageDirs(monorepoRoot);
  const packageDir = findContainingPackageDir(cwd, workspacePackageDirs);
  if (packageDir !== undefined) {
    await cleanReportedPackage(packageDir, options);
    return { kind: 'package', checkResultsDir: monorepoRoot, packageDir };
  }

  return sweepWorkspace(monorepoRoot, workspacePackageDirs, options);
}

/**
 * Removes a package's build output and the build-cache entries that describe it, so the package does not keep
 * any state that would make the next build skip. Removal is idempotent: An already-clean package is a silent
 * no-op.
 */
export async function cleanPackage(packageDir: string): Promise<void> {
  await rm(path.resolve(packageDir, OUTPUT_ROOT), { recursive: true, force: true });
  await rm(resolveBuildCachePath(packageDir), { force: true });
  await rm(resolveEmitDurationPath(packageDir), { force: true });
}

/**
 * Runs `nmr-clean` against `argv` from `cwd` and returns the exit code to report. The command takes neither an
 * option nor an operand, so anything but `--help` is a usage error and removes nothing.
 *
 * This is the default `clean` script, and it is published as a bin because, under pnpm's isolated layout,
 * `pnpm exec` resolves only the bins of the consuming project's direct dependencies: pnpm links nmr's own bins
 * into the consumer's `node_modules/.bin`, but not the bins of nmr's dependencies.
 */
export async function runClean(argv: string[], cwd: string): Promise<number> {
  const command = defineCommand({
    summary: 'Remove the build output and build cache of this package, or of every package from the monorepo root',
    run: async () => {
      const style = resolveBinStyles().stdout;
      const outcome = await cleanFrom(cwd, {
        onProgress: (progress) => {
          console.info(renderCleanProgress(progress, style));
        },
        stderr: process.stderr,
        stdout: process.stdout,
      });

      const closing = renderCleanOutcome(outcome, style);
      if (closing !== undefined) {
        reportClosing(closing);
      }
      return 0;
    },
  });

  return runCli(argv, command, { name: NMR_CLEAN_BIN, stdout: process.stdout, stderr: process.stderr, baseDir: cwd });
}

// region | Helpers

/** Cleans a package in-process and reports it as cleaned. */
async function cleanReportedPackage(packageDir: string, options: CleanOptions): Promise<void> {
  await cleanPackage(packageDir);
  options.onProgress?.({ kind: 'package-cleaned', packageDir });
}

/** Removes every recorded check result for `scopeDir`, so nothing survives to make the next check skip. */
async function clearCheckCache(scopeDir: string, options: CleanOptions): Promise<void> {
  await removeCheckCache(scopeDir);
  options.onProgress?.({ kind: 'check-results-removed' });
}

/**
 * Cleans every workspace package by running each package's resolved `clean`: A package that overrides
 * `clean`, in config or in its own `package.json`, still gets its own command rather than this sweep.
 *
 * The sweep runs in a single process, and only for the built-in clean. In a repo that builds nmr itself,
 * cleaning removes the very output from which the `nmr` and `nmr-clean` binaries load, so re-invoking a
 * binary per package fails partway through and leaves most packages uncleaned; one process resolves its
 * imports up front and is unaffected when they are deleted afterwards. Spawning an override is safe,
 * because an override is an ordinary command that does not load that output.
 */
async function sweepWorkspace(
  monorepoRoot: string,
  workspacePackageDirs: string[],
  options: CleanOptions,
): Promise<CleanOutcome> {
  const config: NmrConfig = await loadRootConfig(monorepoRoot);
  // Build the registry once, because every package resolves the same one; only tier-3 resolution varies per package.
  const registry = buildWorkspaceRegistry(config);

  const cleanedDirs: string[] = [];
  let skippedCount = 0;

  for (const packageDir of workspacePackageDirs) {
    const resolvedScript = resolveScript(CLEAN_COMMAND, registry, packageDir, false);
    const resolvedCommand = resolvedScript === undefined ? undefined : renderChain(resolvedScript.steps);

    // An empty command is the package.json convention for "skip this script".
    if (resolvedCommand === undefined || resolvedCommand === '') {
      skippedCount++;
      continue;
    }

    if (resolvedCommand === BUILT_IN_CLEAN) {
      await cleanReportedPackage(packageDir, options);
      cleanedDirs.push(packageDir);
      continue;
    }

    const { exitCode } = await runCommand(resolvedCommand, packageDir, {
      bin: NMR_CLEAN_BIN,
      channels: { stderr: resolveChannel(options.stderr, false), stdout: resolveChannel(options.stdout, false) },
      stderr: options.stderr,
      stdout: options.stdout,
    });
    if (exitCode !== 0) {
      throw new UserError(`\`${resolvedCommand}\` failed in ${path.basename(packageDir)} with exit code ${exitCode}.`);
    }
    cleanedDirs.push(packageDir);
  }

  return { kind: 'sweep', checkResultsDir: monorepoRoot, cleanedDirs, skippedCount };
}

// endregion | Helpers
