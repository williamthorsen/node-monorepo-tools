import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { Writable } from 'node:stream';

import { describeError } from '@williamthorsen/toolbelt.errors';

import { isCacheableCommand, PASS_MANIFEST_DIR_ENV_VAR, writeDebugNote } from './check-cache.ts';
import { isReplayLine, type ReplayLine } from './check-cache-entries.ts';
import { MAX_EXCERPT_BYTES } from './helpers/deriveExcerpt.ts';
import { isObject } from './helpers/type-guards.ts';
import type { CheckCacheConfig } from './types.ts';

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
  /** The scope's directory, in the form that `formatManifestScope` renders. */
  scope: string;
  treeHash: string;
}

/** Renders a scope's directory as a manifest entry names it: relative to the root, `.` for the root itself. */
export function formatManifestScope(monorepoRoot: string, anchorDir: string): string {
  const scope = path.relative(monorepoRoot, anchorDir);

  return scope === '' ? '.' : scope.split(path.sep).join('/');
}

/**
 * Returns the entries of a host's pass manifest that this machine may record, dropping each of the others with a debug
 * note. The manifest is untrusted, so an entry is kept only when it has the entry's shape, names the monorepo root or
 * one of its workspace packages by a relative path, names a command that is cacheable here, describes `treeId`, and
 * replays only excerpts that a pass could have recorded.
 *
 * A manifest of more entries than any run produces is rejected whole, so that a hostile one cannot fill the cache.
 */
export function validatePassManifest(options: {
  checkCache: CheckCacheConfig | undefined;
  entries: readonly unknown[];
  env: NodeJS.ProcessEnv;
  monorepoRoot: string;
  stderr: Writable;
  treeId: string;
  workspacePackageDirs: readonly string[];
}): PassManifestEntry[] {
  const { entries, env, stderr } = options;
  if (entries.length > MAX_MANIFEST_ENTRIES) {
    writeDebugNote(`not learning from a pass manifest of ${entries.length} entries`, env, stderr);
    return [];
  }

  const scopeDirs = new Set([options.monorepoRoot, ...options.workspacePackageDirs].map((dir) => path.resolve(dir)));

  return entries.filter((entry): entry is PassManifestEntry => {
    const reason = findRejection(entry, { ...options, scopeDirs });
    if (reason !== undefined) {
      writeDebugNote(`not learning a pass from the manifest: ${reason}`, env, stderr);
    }
    return reason === undefined;
  });
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

  const entry: PassManifestEntry = {
    command,
    commandString: options.commandString,
    durationMs: options.durationMs,
    ...(options.replay !== undefined && options.replay.length > 0 && { replay: options.replay }),
    scope: formatManifestScope(options.monorepoRoot, options.anchorDir),
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

// region | Helpers

/** Bounds a manifest well above the passes that any run reports. */
const MAX_MANIFEST_ENTRIES = 1_000;

/** Returns why a manifest entry may not be recorded, or `undefined` when it may. */
function findRejection(
  entry: unknown,
  options: { checkCache: CheckCacheConfig | undefined; monorepoRoot: string; scopeDirs: Set<string>; treeId: string },
): string | undefined {
  if (!isPassManifestEntry(entry)) {
    return 'the entry is malformed';
  }

  const { command, scope } = entry;
  if (!isRelativeScope(scope) || !options.scopeDirs.has(path.resolve(options.monorepoRoot, scope))) {
    return `${command} names a scope outside the workspace (${scope})`;
  }
  if (!isCacheableCommand(options.checkCache, command)) {
    return `${command} is not cacheable here`;
  }
  if (entry.treeHash !== options.treeId) {
    return `${command} passed on another tree`;
  }
  if (entry.replay?.some((line) => Buffer.byteLength(line.excerpt) > MAX_EXCERPT_BYTES) === true) {
    return `${command} replays an excerpt longer than a pass records`;
  }

  return undefined;
}

/** Narrows a parsed manifest entry. */
function isPassManifestEntry(value: unknown): value is PassManifestEntry {
  return (
    isObject(value) &&
    typeof value['command'] === 'string' &&
    typeof value['commandString'] === 'string' &&
    typeof value['durationMs'] === 'number' &&
    Number.isFinite(value['durationMs']) &&
    value['durationMs'] >= 0 &&
    (value['replay'] === undefined || (Array.isArray(value['replay']) && value['replay'].every(isReplayLine))) &&
    typeof value['scope'] === 'string' &&
    typeof value['treeHash'] === 'string'
  );
}

/** Reports whether a scope is `.` or a relative POSIX path that stays inside the directory to which it is relative. */
function isRelativeScope(scope: string): boolean {
  if (scope === '.') {
    return true;
  }

  return (
    !path.posix.isAbsolute(scope) &&
    scope.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

// endregion | Helpers
