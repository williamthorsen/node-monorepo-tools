import { realpathSync } from 'node:fs';
import path from 'node:path';

import { isObject } from './helpers/type-guards.ts';
import { UserError } from './UserError.ts';

/**
 * Carries the entries that a run is inside, from the outermost inward, down to every process that it spawns. An
 * entry that finds itself already on the chain would re-enter itself without bound.
 */
export const ENTRY_CHAIN_ENV_VAR = 'NMR_ENTRY_CHAIN';

/** A command that an invocation resolved, and the directory whose registry it resolved the command from. */
export interface ChainEntry {
  command: string;
  dir: string;
}

/**
 * Admits an invocation onto the chain that it inherited, returning the environment that its steps inherit in turn.
 * Throws a `UserError` when an ancestor in the run is already running the same command from the same directory, or
 * when the inherited chain cannot be read.
 *
 * Records the directory's real path, so that a symlinked checkout or a `/private` prefix seen by one process and not
 * another cannot hide a repeat.
 */
export function enterChain(options: {
  anchorDir: string;
  command: string;
  env: NodeJS.ProcessEnv;
  monorepoRoot: string;
}): NodeJS.ProcessEnv {
  const { anchorDir, command, env, monorepoRoot } = options;

  const chain = readEntryChain(env[ENTRY_CHAIN_ENV_VAR]);
  if (chain === undefined) {
    throw new UserError(
      `${ENTRY_CHAIN_ENV_VAR} is not a chain that nmr wrote; unset it. nmr passes it to the processes that it starts.`,
    );
  }

  const entry: ChainEntry = { command, dir: realpathSync(anchorDir) };
  const extendedChain = [...chain, entry];

  if (chain.some((ancestor) => ancestor.command === entry.command && ancestor.dir === entry.dir)) {
    throw new UserError(formatReentryError(extendedChain, realpathSync(monorepoRoot)));
  }

  return { ...env, [ENTRY_CHAIN_ENV_VAR]: JSON.stringify(extendedChain) };
}

// region | Helpers

/** Renders an entry's directory relative to the monorepo root, naming the root itself `root`. */
function describeDir(dir: string, monorepoRoot: string): string {
  const relativeDir = path.relative(monorepoRoot, dir);
  if (relativeDir === '') {
    return 'root';
  }

  return relativeDir.startsWith('..') || path.isAbsolute(relativeDir) ? dir : relativeDir;
}

/** Names the repeating entry, then lists the chain that reached it, marking each occurrence of the repeat. */
function formatReentryError(chain: readonly ChainEntry[], monorepoRoot: string): string {
  const repeat = chain.at(-1);
  if (repeat === undefined) {
    throw new Error('A re-entry error needs the entry that repeats.');
  }

  const repeatDir = describeDir(repeat.dir, monorepoRoot);
  const lines = chain.map((entry) => {
    const isRepeat = entry.command === repeat.command && entry.dir === repeat.dir;
    return `  ${entry.command} in ${describeDir(entry.dir, monorepoRoot)}${isRepeat ? '  (repeat)' : ''}`;
  });

  return [
    `nmr re-entered \`${repeat.command}\` in ${repeatDir}, which this run is already running there, ` +
      'so the run would never end. The entries that this run has entered, outermost first:',
    ...lines,
  ].join('\n');
}

/** Reports whether a value is a chain entry. */
function isChainEntry(value: unknown): value is ChainEntry {
  return isObject(value) && typeof value['command'] === 'string' && typeof value['dir'] === 'string';
}

/** Reads an inherited chain, an unset or empty value as an empty one, or returns `undefined` for a malformed one. */
function readEntryChain(value: string | undefined): readonly ChainEntry[] | undefined {
  if (value === undefined || value === '') {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }

  return Array.isArray(parsed) && parsed.every(isChainEntry) ? parsed : undefined;
}

// endregion | Helpers
