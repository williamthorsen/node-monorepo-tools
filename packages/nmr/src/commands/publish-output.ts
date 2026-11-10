import { existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { UserError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { getCompiler } from './compiler.ts';
import { isWithin } from './rewrite-specifiers.ts';

/** The pair of directories through which a build publishes, both siblings of the emit directory. */
export interface ScratchDirs {
  previousDir: string;
  stagingDir: string;
}

/** One file emitted by the compiler, kept in memory until the whole emit is ready to publish. */
export interface StagedFile {
  text: string;
  writeByteOrderMark: boolean;
}

/**
 * Removes both scratch directories of `emitDir` without failing the caller. `force` suppresses only a missing
 * top-level path and `rm` does not retry, so a removal racing another build's leaves `ENOTEMPTY`, `EBUSY`, and
 * `EPERM` live.
 */
export async function discardScratchDirs(emitDir: string): Promise<void> {
  try {
    await removeScratchDirs(emitDir);
  } catch {
    // The removal is advisory: A directory that survives is cleared by the next emit or the next skip.
  }
}

/**
 * Publishes the staged emit to `emitDir` atomically: It writes the files to a staging directory and swaps that
 * into place by rename. Returns how many files it published.
 *
 * An emit that produces nothing removes `emitDir` instead, because swapping an empty directory into place would
 * leave a `dist` behind for a package whose entry points do not emit any output.
 *
 * A failure while staging precedes the first rename, so it leaves the previous output exactly as it was.
 */
export async function publishOutput(emitDir: string, stagedFiles: Map<string, StagedFile>): Promise<number> {
  if (stagedFiles.size === 0) {
    await rm(emitDir, { force: true, recursive: true });
    return 0;
  }

  writeStagedOutput(stagedFiles, emitDir);
  await swapIntoPlace(emitDir);

  return stagedFiles.size;
}

/** Removes both scratch directories of `emitDir`, tolerating their absence. */
export async function removeScratchDirs(emitDir: string): Promise<void> {
  const { previousDir, stagingDir } = resolveScratchDirs(emitDir);
  await rm(previousDir, { force: true, recursive: true });
  await rm(stagingDir, { force: true, recursive: true });
}

/**
 * Resolves the two scratch directories through which a build publishes: `staging`, which the emit is written to,
 * and `previous`, which the outgoing output is renamed aside to. Both are siblings of the emit directory, so a
 * rename between them never crosses a filesystem, and both are dot-prefixed so that a leftover stays out of the
 * globs that select sources.
 *
 * The names are fixed rather than unique because the build removes both before use. A unique name would need a
 * sweep to accomplish that removal, and a sweep cannot tell a directory orphaned by a killed run from one that a
 * concurrent build is still writing. Because a directory left behind by a failed build is cleared the same way,
 * the failure path does not need any cleanup of its own.
 */
export function resolveScratchDirs(emitDir: string): ScratchDirs {
  const parent = path.dirname(emitDir);
  const name = path.basename(emitDir);

  return {
    previousDir: path.join(parent, `.${name}.previous`),
    stagingDir: path.join(parent, `.${name}.staging`),
  };
}

// region | Helpers

/**
 * Publishes the staged output by rename: It moves the outgoing directory aside, moves staging into its place,
 * and discards the outgoing copy. The output directory is therefore absent only between the two renames, rather
 * than for the duration of an emit.
 *
 * If the second rename fails, the outgoing directory is moved back, so a half-completed swap never leaves the
 * package without any output at all.
 */
async function swapIntoPlace(emitDir: string): Promise<void> {
  const { previousDir, stagingDir } = resolveScratchDirs(emitDir);
  const hadPreviousOutput = existsSync(emitDir);
  if (hadPreviousOutput) {
    await rename(emitDir, previousDir);
  }

  try {
    await rename(stagingDir, emitDir);
  } catch (error: unknown) {
    // Restore only when `previousDir` contains the outgoing output and nothing has since taken its place.
    if (hadPreviousOutput && !existsSync(emitDir)) {
      await rename(previousDir, emitDir);
    }
    throw new UserError(`failed to move the built output into ${emitDir}: ${describeError(error)}`, {
      cause: error,
    });
  }

  await discardScratchDirs(emitDir);
}

/**
 * Writes every emitted file into the staging directory, at its path relative to the emit directory for which it
 * was emitted. `ts.sys.writeFile` does the writing, so the byte-order mark that the compiler asked for survives
 * and intermediate directories appear exactly as a direct emit would have created them.
 *
 * A file outside the emit directory fails the build. Because the build pins `outDir` and `declarationDir` to the
 * same directory, this is unreachable -- which is the point: Mapping the path across would otherwise discard, in
 * silence, a file that a direct emit would have written.
 */
function writeStagedOutput(stagedFiles: Map<string, StagedFile>, emitDir: string): void {
  const ts = getCompiler();
  const { stagingDir } = resolveScratchDirs(emitDir);
  for (const [fileName, file] of stagedFiles) {
    if (!isWithin(emitDir, fileName)) {
      throw new Error(
        `the compiler emitted ${fileName}, which is outside the output directory ${emitDir}. ` +
          "Verify the resolved tsconfig's 'outDir' and 'declarationDir'.",
      );
    }
    ts.sys.writeFile(path.join(stagingDir, path.relative(emitDir, fileName)), file.text, file.writeByteOrderMark);
  }
}

// endregion | Helpers
