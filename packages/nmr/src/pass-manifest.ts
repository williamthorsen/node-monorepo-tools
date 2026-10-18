import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { Writable } from 'node:stream';

import { describeError } from '@williamthorsen/toolbelt.errors';

import { PASS_MANIFEST_DIR_ENV_VAR, writeDebugNote } from './check-cache.ts';
import type { ReplayLine } from './check-cache-entries.ts';

/**
 * One pass that an nmr process on a host recorded or recalled during a delegated run, as the host session returns it
 * to the delegating machine.
 */
export interface PassManifestEntry {
  command: string;
  commandString: string;
  /** How long the pass took when it was earned, which a recall reports as the time that it saved. */
  durationMs: number;
  replay?: ReplayLine[];
  /** The scope's directory relative to the monorepo root, `.` for the root itself. */
  scope: string;
  treeHash: string;
}

/**
 * Writes one entry into the directory that `NMR_PASS_MANIFEST_DIR` names, and does nothing when it is unset. Each
 * entry is a file of its own, so that the processes of a fan-out cannot interleave their writes.
 *
 * A manifest that cannot be written is not worth failing a green run over: the failure goes to the debug note.
 */
export async function writePassManifestEntry(options: {
  anchorDir: string;
  command: string;
  commandString: string;
  durationMs: number;
  env: NodeJS.ProcessEnv;
  monorepoRoot: string;
  replay: ReplayLine[] | undefined;
  stderr: Writable;
  treeHash: string;
}): Promise<void> {
  const { command, env, stderr } = options;
  const manifestDir = env[PASS_MANIFEST_DIR_ENV_VAR];
  if (manifestDir === undefined || manifestDir === '') {
    return;
  }

  const scope = path.relative(options.monorepoRoot, options.anchorDir);
  const entry: PassManifestEntry = {
    command,
    commandString: options.commandString,
    durationMs: options.durationMs,
    ...(options.replay !== undefined && options.replay.length > 0 && { replay: options.replay }),
    scope: scope === '' ? '.' : scope.split(path.sep).join('/'),
    treeHash: options.treeHash,
  };

  try {
    await writeFile(path.join(manifestDir, `${process.pid}-${randomUUID()}.json`), JSON.stringify(entry), {
      flag: 'wx',
    });
  } catch (error: unknown) {
    writeDebugNote(`could not report ${command} to the delegating machine: ${describeError(error)}`, env, stderr);
  }
}
