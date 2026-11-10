import path from 'node:path';
import process from 'node:process';

import { defineCommand, runCli } from '@williamthorsen/nmr-core/cli';

import { NMR_COMPILE_BIN } from '../bins.ts';
import { loadWorkspaceConfig } from '../config.ts';
import { resolveBinStyles } from '../resolveBinStyles.ts';
import { buildPackage } from './build.ts';
import { renderBuildOutcome, renderBuildProgress } from './build-report.ts';

/**
 * Runs `nmr-compile` against `argv` for the package at `packageDir` and returns the exit code to report. The command
 * takes neither an option nor an operand, so anything but `--help` is a usage error and compiles nothing.
 */
export async function runCompile(argv: string[], packageDir: string): Promise<number> {
  const command = defineCommand({
    summary: "Compile the package's src tree to dist/esm",
    run: async () => {
      const { stdout } = resolveBinStyles();
      const { build } = await loadWorkspaceConfig(packageDir);

      const packageName = path.basename(packageDir);

      const outcome = await buildPackage(packageDir, {
        onProgress: (progress) => {
          console.info(renderBuildProgress(progress, packageName, stdout));
        },
        ...(build?.extraIgnorePatterns !== undefined && { extraIgnorePatterns: build.extraIgnorePatterns }),
      });
      console.info(renderBuildOutcome(outcome, packageName, stdout));
      return 0;
    },
  });

  return runCli(argv, command, {
    name: NMR_COMPILE_BIN,
    stdout: process.stdout,
    stderr: process.stderr,
    baseDir: packageDir,
  });
}
