import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import type { Writable } from 'node:stream';

import { hashWorkingTree, type OutputStyle, readHeadSha, STATUS_GLYPHS } from '@williamthorsen/nmr-core';

import { isHookName } from './helpers/hook-name.ts';
import type { CheckCacheConfig } from './types.ts';

/** One working tree, observed once per top-level invocation and shared with every process below it. */
export interface TreeSnapshot {
  treeId: string;
  headSha: string;
}

/** Set to `1` to hear why the gate did not skip, or why it is disabled. */
export const DEBUG_ENV_VAR = 'NMR_DEBUG';

/**
 * The commands cacheable without configuration: those whose whole contribution is an exit status, and that
 * reach nothing beyond a checkout and an install.
 *
 * Excluded commands: `audit` and `prepush` consult a vulnerability database that changes without the tree
 * (`prepush`'s `ci` constituent still skips while its `audit` always runs). `build` and `compile` have a cache
 * of their own. `fix`, `fmt`, `lint`, and `upgrade` mutate the tree about which they are asked. `test:all` reaches
 * whatever the environment supplies. Anything a repo adds here promises exit-status-only semantics through its
 * whole chain, hooks included.
 */
export const DEFAULT_CACHEABLE_COMMANDS = [
  'check',
  'check:strict',
  'ci',
  'fix:check',
  'fmt:check',
  'lint:check',
  'lint:strict',
  'root:check',
  'root:lint:check',
  'root:lint:strict',
  'root:test',
  'root:test:tool',
  'root:test:unit',
  'root:typecheck',
  'test',
  'test:coverage',
  'test:tool',
  'test:unit',
  'typecheck',
];

/** Set to `1` for the standing equivalent of `--no-cache`: skip the lookup, still record on success. */
export const NO_CACHE_ENV_VAR = 'NMR_NO_CACHE';

/** Passes one run's identity down the spawned chain, so that an entry can name the run that vouched for it. */
export const RUN_ID_ENV_VAR = 'NMR_RUN_ID';

/** Passes the top-level tree snapshot down the spawned chain, to make one invocation hash the tree only once. */
export const TREE_SNAPSHOT_ENV_VAR = 'NMR_TREE_SNAPSHOT';

/** Renders a snapshot for the environment of every process below this one. */
export function encodeTreeSnapshot(snapshot: TreeSnapshot): string {
  return `${snapshot.treeId} ${snapshot.headSha}`;
}

/**
 * Renders the warning for a `--no-cache` that appears after the command name, which makes it an argument to
 * the command rather than a flag to nmr. nmr passes the argument on unchanged, so the warning is the only sign
 * that nmr did not read it.
 */
export function formatMisplacedNoCacheWarning(command: string, style: OutputStyle): string {
  return (
    `${STATUS_GLYPHS[style].warning.text} --no-cache after the command name is passed to \`${command}\`, ` +
    `not read by nmr. Did you mean \`nmr --no-cache ${command}\`?`
  );
}

/**
 * Reports whether a command's passes are recorded at all, which separates a command without a recording from
 * one that could never have had one.
 *
 * A hook is never cacheable, even when a repo names one in `extraCommands`: nothing records a hook, and
 * excluding it here keeps the gate and every reader of its entries in agreement.
 */
export function isCacheableCommand(checkCache: CheckCacheConfig | undefined, command: string): boolean {
  return !isHookName(command) && checkCache?.enabled !== false && resolveCacheableCommands(checkCache).has(command);
}

/**
 * Merges a repo's `checkCache` configuration into the default set: `extraCommands` adds to the defaults, and
 * `excludeCommands` removes a command whose chain does more than report an exit status.
 */
export function resolveCacheableCommands(checkCache: CheckCacheConfig | undefined): Set<string> {
  const commands = new Set([...DEFAULT_CACHEABLE_COMMANDS, ...(checkCache?.extraCommands ?? [])]);
  const excludedCommands = checkCache?.excludeCommands ?? [];
  for (const excludedCommand of excludedCommands) {
    commands.delete(excludedCommand);
  }

  return commands;
}

/**
 * Resolves the identity of the run to which this invocation belongs: the one that an ancestor nmr process passed
 * down, and otherwise a fresh one, because the run starts at this invocation.
 *
 * Unbounded, whereas the tree snapshot is bounded by a HEAD comparison: a process that outlives its run hands a
 * stale identity to the invocations that it later makes, and the tree id keeps that harmless, because every
 * constituent entry is held to it before its excerpt joins an assembly.
 */
export function resolveRunId(env: NodeJS.ProcessEnv): string {
  const inheritedRunId = env[RUN_ID_ENV_VAR];

  return inheritedRunId === undefined || inheritedRunId === '' ? randomUUID() : inheritedRunId;
}

/**
 * Resolves the tree snapshot on which this invocation gates: the one that a parent nmr process already took,
 * when there is one, and otherwise a fresh hash of the working tree. Reports a reason instead when a snapshot
 * cannot be taken, which disables the gate.
 *
 * The monorepo root must be the git toplevel. A repository containing the monorepo inside a subdirectory has
 * content outside it that the checks may still read, and a hash covering more than the monorepo would move
 * for edits that cannot affect it.
 */
export function resolveTreeSnapshot(options: {
  monorepoRoot: string;
  env: NodeJS.ProcessEnv;
}): { ok: true; snapshot: TreeSnapshot } | { ok: false; reason: string } {
  // An inherited snapshot is trusted only while HEAD points to the commit that it pointed to when the snapshot
  // was taken. A process that outlives the run that spawned it keeps the variable in its environment, and would
  // otherwise gate a later invocation on an observation of a tree that has since moved on.
  const inheritedSnapshot = decodeTreeSnapshot(options.env[TREE_SNAPSHOT_ENV_VAR]);
  if (inheritedSnapshot !== undefined && readHeadSha(options.monorepoRoot) === inheritedSnapshot.headSha) {
    return { ok: true, snapshot: inheritedSnapshot };
  }

  const hashedTree = hashWorkingTree(options.monorepoRoot);
  if (!hashedTree.ok) {
    return hashedTree;
  }

  let physicalRoot: string;
  try {
    physicalRoot = realpathSync(options.monorepoRoot);
  } catch {
    return { ok: false, reason: `could not resolve ${options.monorepoRoot}` };
  }
  if (hashedTree.toplevel !== physicalRoot) {
    return { ok: false, reason: `the monorepo root is not the git toplevel (${hashedTree.toplevel})` };
  }

  return { ok: true, snapshot: { treeId: hashedTree.treeId, headSha: hashedTree.headSha } };
}

/**
 * Writes a note explaining a gate decision, but only when `NMR_DEBUG=1`. The gate is silent by default: a
 * reason to run is not news, and a line per invocation explaining why nothing was skipped would bury the
 * output of the command that did run.
 */
export function writeDebugNote(message: string, env: NodeJS.ProcessEnv, stderr: Writable): void {
  if (env[DEBUG_ENV_VAR] === '1') {
    stderr.write(`nmr check-cache: ${message}\n`);
  }
}

// region | Helpers

/** Reads a snapshot encoded by a parent process, or `undefined` when the value is absent or malformed. */
function decodeTreeSnapshot(encodedSnapshot: string | undefined): TreeSnapshot | undefined {
  if (encodedSnapshot === undefined) {
    return undefined;
  }

  const [treeId, headSha] = encodedSnapshot.split(' ', 2);
  if (treeId === undefined || headSha === undefined || treeId === '' || headSha === '') {
    return undefined;
  }

  return { treeId, headSha };
}

// endregion | Helpers
