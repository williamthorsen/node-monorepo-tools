import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { Writable } from 'node:stream';

import type { CacheEntryRef } from '@williamthorsen/nmr-core';
import {
  hashWorkingTree,
  readCacheEntry,
  readHeadSha,
  readJsonCacheEntry,
  removeCacheDir,
  removeCacheEntry,
  resolveCacheEntryPath,
  writeCacheEntry,
} from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { hasBuildOutput, readBuildDigest } from './commands/build-output.ts';
import { loadWorkspaceConfig } from './config.ts';
import { isHookName } from './helpers/hook-name.ts';
import { isObject, isStringRecord } from './helpers/type-guards.ts';
import type { ScriptRegistry } from './resolve-scripts.ts';
import { getDefaultWorkspaceScripts } from './resolve-scripts.ts';
import { buildWorkspaceRegistry, resolveScript } from './resolver.ts';
import type { OutputChannel, OutputChannels } from './runner.ts';
import { renderChain } from './steps.ts';
import type { CheckCacheConfig, NmrConfig } from './types.ts';
import { getWorkspacePackageDirs } from './workspace.ts';

/** A recorded pass: what ran, on which tree, and what it cost. */
export interface CheckCacheEntry {
  /** The full cache key the pass was recorded under; a hit is this matching the key computed now. */
  key: string;
  treeHash: string;
  headSha: string;
  commandString: string;
  nmrVersion: string;
  nodeVersion: string;
  durationMs: number;
  /** ISO-8601 instant the pass completed. */
  recordedAt: string;
  /**
   * The build digest each covered package's output carried when the pass was recorded. Build output is
   * git-ignored, so the tree hash cannot describe it; comparing these is what separates output built from this
   * tree from output another tree left behind.
   */
  buildDigests: Record<string, string>;
  /** What a skip replays in place of the run it recalls, absent on a pass that retained nothing. */
  retention?: Retention;
}

/** What locates one command's recorded pass at one scope, and the transcript beside it. */
export interface EntryRef {
  anchorDir: string;
  command: string;
  monorepoRoot: string;
}

/** One command's excerpt, attributed to the scope and the command that produced it. */
export interface ReplayLine {
  command: string;
  excerpt: string;
  scope: string;
}

/**
 * What a recalled pass replays, the key certifying the excerpts describe this environment's output, and the
 * run that last vouched for them.
 *
 * A list rather than one excerpt: a composite's entry carries its constituents' lines, and a nested one's are
 * spliced into its parent's, where the attribution cannot be re-derived from the entry that holds them.
 *
 * The witness is what admits a constituent's line into the assembly its parent records: a run writes it when
 * it records an excerpt, and restamps it when it recalls one and replays it.
 */
export interface Retention {
  key: string;
  replay: ReplayLine[];
  runId: string;
}

/** What nmr's own build has left on disk across the workspace. */
export interface BuildOutputState {
  /** Covered packages whose output is absent. */
  missing: string[];
  /** The digest of the inputs each covered package's output was built from, keyed by package name. */
  digests: Record<string, string>;
}

/** The parts of the running interpreter that can change what a check concludes. */
export interface RuntimeIdentity {
  arch: string;
  nodeVersion: string;
  platform: string;
}

/** One working tree, observed once per top-level invocation and shared with every process below it. */
export interface TreeSnapshot {
  hash: string;
  headSha: string;
}

/** The interpreter this process is running on, folded into every key and recorded alongside every pass. */
export const CURRENT_RUNTIME: RuntimeIdentity = {
  arch: process.arch,
  nodeVersion: process.version,
  platform: process.platform,
};

/** Set to `1` to hear why the gate did not skip, or why it is disabled. */
export const DEBUG_ENV_VAR = 'NMR_DEBUG';

/**
 * The commands cacheable without configuration: those whose whole contribution is an exit status, and that
 * reach nothing beyond a checkout and an install.
 *
 * Excluded on purpose. `audit` and `prepush` consult a vulnerability database that changes without the tree
 * (`prepush`'s `ci` constituent still skips while its `audit` always runs). `build` and `compile` carry a cache
 * of their own. `fix`, `fmt`, `lint`, and `upgrade` mutate the tree they are asked about. `test:all` reaches
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

/** Carries one run's identity down the spawned chain, so an entry can name the run that vouched for it. */
export const RUN_ID_ENV_VAR = 'NMR_RUN_ID';

/** Carries the top-level tree snapshot down the spawned chain, so one invocation hashes the tree once. */
export const TREE_SNAPSHOT_ENV_VAR = 'NMR_TREE_SNAPSHOT';

/** The default `compile` script: nmr's own build. */
const BUILT_IN_COMPILE = 'nmr-compile';

/** The tool whose cache directory holds check results. */
const CACHE_TOOL = 'nmr-check';

/**
 * The pnpm files that together describe what is installed. Both are internal to pnpm; either one going missing
 * disables the gate, which is the safe direction, and a pnpm release that moves them has the same effect.
 */
const INSTALL_FINGERPRINT_FILES = [
  path.join('node_modules', '.modules.yaml'),
  path.join('node_modules', '.pnpm', 'lock.yaml'),
];

/** Names the fold. Bump it whenever an ingredient is added or removed, so older entries read as misses. */
const KEY_FORMAT = 'nmr-check-cache-v1';

/**
 * Environment variables a check can read its way to a different conclusion through. A repo needing more folds
 * them in by excluding the affected command rather than by extending this list, which stays fixed so that the
 * key is the same on two machines that merely differ in shell decoration.
 */
const KEYED_ENV_VARS = ['LANG', 'LC_ALL', 'NODE_OPTIONS', 'TZ'];

/** Names the retention fold. Bump it to invalidate retained excerpts without invalidating a single pass. */
const RETENTION_KEY_FORMAT = 'nmr-retention-v1';

/**
 * Environment variables a tool reads to decide how to present itself. They change what a transcript looks
 * like without changing what the command concludes, so they belong to the retention key alone: a run under a
 * different terminal width recalls the same pass and declines to replay its excerpt.
 */
const RETENTION_KEYED_ENV_VARS = ['CI', 'COLUMNS', 'FORCE_COLOR', 'NO_COLOR', 'TERM'];

/** Characters a command name may contribute to a file name; every other character becomes a hyphen. */
const UNSAFE_SLUG_CHARACTERS = /[^\w.-]+/g;

/**
 * Restamps a recalled entry's retention with the run that is replaying it, so an excerpt this run certified
 * can join the assembly a composite above it records.
 *
 * A recall certifies as surely as a recording does: the pass key matched, so the excerpt describes this tree,
 * and the caller reaches this only where the retention key matched too, so it describes this presentation
 * environment. Everything else the entry records stands -- the instant and the duration belong to the run that
 * earned the pass, and a recall must not make it read as later or longer than it was.
 *
 * A cache that cannot be written is not worth failing a green run over, so that failure goes to the debug note.
 */
export async function certifyRetention(options: {
  anchorDir: string;
  command: string;
  entry: CheckCacheEntry;
  env: NodeJS.ProcessEnv;
  monorepoRoot: string;
  runId: string;
  stderr: Writable;
}): Promise<void> {
  const { entry, runId } = options;
  if (entry.retention === undefined || entry.retention.runId === runId) {
    return;
  }

  try {
    await writeCheckCacheEntry({
      anchorDir: options.anchorDir,
      command: options.command,
      monorepoRoot: options.monorepoRoot,
      entry: { ...entry, retention: { ...entry.retention, runId } },
    });
  } catch (error: unknown) {
    writeDebugNote(`could not certify ${options.command}: ${describeError(error)}`, options.env, options.stderr);
  }
}

/**
 * Folds everything that can change what a command concludes into one key: the tree's content, the command
 * string that would run, the scope it would run in, nmr's own version, the interpreter, what is installed, and
 * the environment variables a check can read. A hit is this key matching a recorded one, so an ingredient left
 * out here is an ingredient that could change while the cache still claims a pass.
 *
 * Reports a reason instead of a key when the install fingerprint cannot be read, which disables the gate.
 */
export function computeCacheKey(options: {
  anchorDir: string;
  command: string;
  commandString: string;
  env: NodeJS.ProcessEnv;
  monorepoRoot: string;
  nmrVersion: string;
  runtime?: RuntimeIdentity;
  snapshot: TreeSnapshot;
}): { ok: true; key: string } | { ok: false; reason: string } {
  const fingerprint = resolveInstallFingerprint(options.monorepoRoot);
  if (!fingerprint.ok) {
    return fingerprint;
  }

  const runtime = options.runtime ?? CURRENT_RUNTIME;
  const scope = path.relative(options.monorepoRoot, options.anchorDir);
  const parts = [
    KEY_FORMAT,
    options.snapshot.hash,
    scope === '' ? '.' : scope,
    options.command,
    options.commandString,
    options.nmrVersion,
    runtime.nodeVersion,
    runtime.platform,
    runtime.arch,
    fingerprint.fingerprint,
  ];

  return { ok: true, key: digestParts([...parts, ...composeEnvParts(KEYED_ENV_VARS, options.env)]) };
}

/**
 * Folds what changes a transcript without changing a conclusion onto the pass key: the channel each of the
 * command's output streams ran on, and the environment variables a tool presents itself through.
 *
 * Taking the pass key as an ingredient rather than recomputing its parts is what keeps the two from drifting
 * apart. The channel kind is what keeps a run at a terminal from replaying a piped recording; folding in raw
 * TTY-ness instead would be wrong under quiet mode, where the child sees pipes at a terminal and the
 * transcript is reproducible.
 */
export function computeRetentionKey(options: {
  channels: OutputChannels;
  env: NodeJS.ProcessEnv;
  passKey: string;
}): string {
  const parts = [
    RETENTION_KEY_FORMAT,
    options.passKey,
    describeChannel(options.channels.stdout),
    describeChannel(options.channels.stderr),
  ];

  return digestParts([...parts, ...composeEnvParts(RETENTION_KEYED_ENV_VARS, options.env)]);
}

/** Renders a snapshot for the environment of every process below this one. */
export function encodeTreeSnapshot(snapshot: TreeSnapshot): string {
  return `${snapshot.hash} ${snapshot.headSha}`;
}

/**
 * Names a covered package whose output differs between two observations of it, or `undefined` when every
 * package agrees. A package that has appeared or disappeared between them counts as a disagreement, because
 * the output the earlier observation describes is not the output the later one found.
 */
export function findStaleBuildOutput(
  earlier: Record<string, string>,
  later: Record<string, string>,
): string | undefined {
  const names = [...new Set([...Object.keys(earlier), ...Object.keys(later)])].toSorted();

  return names.find((name) => earlier[name] !== later[name]);
}

/**
 * Renders the warning for a `--no-cache` that landed after the command name, where it is an argument to the
 * command rather than a flag to nmr. Passing it on unchanged is the honest thing to do with an argument, so
 * the warning is all that separates this from a silently un-bypassed run.
 */
export function formatMisplacedNoCacheWarning(command: string): string {
  return (
    `⚠️ --no-cache after the command name is passed to \`${command}\`, not read by nmr. ` +
    `Did you mean \`nmr --no-cache ${command}\`?`
  );
}

/**
 * Reports whether a command's passes are recorded at all, which is what separates a command with no recording
 * from one that could never have had one.
 *
 * A hook is excluded here rather than at one caller: it is not a command anyone asks for, so nothing records
 * it, and a repo naming one in `extraCommands` must not make the gate and a reader of its entries disagree.
 */
export function isCacheableCommand(checkCache: CheckCacheConfig | undefined, command: string): boolean {
  return !isHookName(command) && checkCache?.enabled !== false && resolveCacheableCommands(checkCache).has(command);
}

/**
 * Reads the state of the build output nmr's own build covers. Build output is git-ignored, so the tree hash
 * says nothing about it: a `ci` whose `build` constituent is cached would otherwise skip on a tree whose `dist`
 * had been deleted, or whose `dist` was compiled from a different tree, and hand back a green exit over a
 * repository that cannot run.
 *
 * A package whose `build` or `compile` is overridden emits somewhere this does not know about, so it is left
 * out rather than made a permanent miss.
 */
export async function readBuildOutputState(monorepoRoot: string, config: NmrConfig): Promise<BuildOutputState> {
  const state: BuildOutputState = { missing: [], digests: {} };

  let packageDirs: string[];
  try {
    packageDirs = getWorkspacePackageDirs(monorepoRoot);
  } catch {
    return state;
  }

  const registry = buildWorkspaceRegistry(config);
  // Hoisted out of the loop, where it does not vary: a repo redefining `build` exempts its whole workspace,
  // and answering that once lets such a repo return without reading a single package.
  if (JSON.stringify(registry['build']) !== JSON.stringify(getDefaultWorkspaceScripts()['build'])) {
    return state;
  }

  for (const packageDir of packageDirs) {
    if (!isProbeSubject(packageDir, registry)) {
      continue;
    }

    // Read on the package's own build options, so the entry set here is the one the build actually compiles.
    // A package whose extra patterns leave nothing to emit expects no output, and reporting it missing would
    // make it a permanent miss that takes the whole repo's gate down with it.
    const { build } = await loadWorkspaceConfig(packageDir);
    const options = build?.extraIgnorePatterns === undefined ? {} : { extraIgnorePatterns: build.extraIgnorePatterns };

    // Relative to the monorepo root rather than a bare basename: a workspace whose globs yield two packages
    // with the same directory name would otherwise record one digest for both, and the shadowed package's
    // output would never be compared. This is the identity `computeCacheKey` already uses for a scope.
    const name = path.relative(monorepoRoot, packageDir);
    if (await hasBuildOutput(packageDir, options)) {
      state.digests[name] = (await readBuildDigest(packageDir)) ?? '';
    } else {
      state.missing.push(name);
    }
  }

  return state;
}

/**
 * Reads the entry recorded for one command at one scope, or `undefined` when there is none to trust.
 *
 * Retention is vouched for separately from the pass it rides on: an excerpt of a shape this cannot read is
 * dropped, leaving a pass that skips cleanly and reports its verdict alone. Voiding the pass instead would
 * cost a full run to avoid a line nobody would have printed.
 */
export async function readCheckCacheEntry(options: {
  anchorDir: string;
  command: string;
  monorepoRoot: string;
}): Promise<CheckCacheEntry | undefined> {
  const parsed = await readJsonCacheEntry(resolveEntryPath(options), isParsedCheckCacheEntry);
  if (parsed === undefined) {
    return undefined;
  }

  const { retention, ...pass } = parsed;

  return isRetention(retention) ? { ...pass, retention } : pass;
}

/**
 * Reads the whole output one recorded pass retained, or `undefined` where it retained none.
 *
 * Held to nothing on its own: the entry beside it is what says which tree the bytes describe, and a caller
 * that has not matched the entry's key is reading a transcript of some other tree.
 */
export async function readTranscript(ref: EntryRef): Promise<string | undefined> {
  return readCacheEntry(resolveEntryPath(ref, '.log'));
}

/**
 * Makes the transcript beside one entry be exactly what this pass retained, removing what an earlier pass
 * left when this one retained nothing.
 *
 * A composite retains nothing of its own, so without the removal a leaf's transcript would stand beside an
 * entry that never produced it, and `--log` would date another run's bytes by this one's instant.
 */
export async function recordTranscript(ref: EntryRef, transcript: string | undefined): Promise<void> {
  const entryPath = resolveEntryPath(ref, '.log');

  if (transcript === undefined) {
    await removeCacheEntry(entryPath);
    return;
  }

  await writeCacheEntry(entryPath, transcript);
}

/** Removes every recorded pass for a monorepo, or for a standalone package outside one. */
export async function removeCheckCache(scopeDir: string): Promise<void> {
  await removeCacheDir({ tool: CACHE_TOOL, scopeDir });
}

/**
 * Merges a repo's `checkCache` configuration into the default set. Extending rather than replacing means
 * declaring one command cannot silently drop the defaults; excluding is how a repo retires a name whose chain
 * turned out to do more than report an exit status.
 */
export function resolveCacheableCommands(checkCache: CheckCacheConfig | undefined): Set<string> {
  const commands = new Set([...DEFAULT_CACHEABLE_COMMANDS, ...(checkCache?.extraCommands ?? [])]);
  const excludedCommands = checkCache?.excludeCommands ?? [];
  for (const excluded of excludedCommands) {
    commands.delete(excluded);
  }

  return commands;
}

/**
 * Resolves the identity of the run this invocation belongs to: the one an ancestor nmr process passed down,
 * and otherwise a fresh one, this invocation being where the run starts.
 *
 * Unbounded where the tree snapshot is bounded by a HEAD comparison: a process that outlives its run hands a
 * stale identity to the invocations it later makes, and what keeps that harmless is the tree hash every
 * constituent entry is held to before its excerpt joins an assembly.
 */
export function resolveRunId(env: NodeJS.ProcessEnv): string {
  const inherited = env[RUN_ID_ENV_VAR];

  return inherited === undefined || inherited === '' ? randomUUID() : inherited;
}

/**
 * Resolves the tree snapshot this invocation gates on: the one a parent nmr process already took, when there
 * is one, and otherwise a fresh hash of the working tree. Reports a reason instead when no snapshot can be
 * had, which disables the gate.
 *
 * The monorepo root must be the git toplevel. A repository holding the monorepo inside a subdirectory has
 * content outside it that the checks may still read, and a hash covering more than the monorepo would move
 * for edits that cannot affect it.
 */
export function resolveTreeSnapshot(options: {
  monorepoRoot: string;
  env: NodeJS.ProcessEnv;
}): { ok: true; snapshot: TreeSnapshot } | { ok: false; reason: string } {
  // An inherited snapshot is trusted only while HEAD stands where it did when the snapshot was taken. A
  // process that outlives the run that spawned it carries the variable with it, and would otherwise gate a
  // later invocation on an observation of a tree that has since moved on.
  const inherited = decodeTreeSnapshot(options.env[TREE_SNAPSHOT_ENV_VAR]);
  if (inherited !== undefined && readHeadSha(options.monorepoRoot) === inherited.headSha) {
    return { ok: true, snapshot: inherited };
  }

  const hashed = hashWorkingTree(options.monorepoRoot);
  if (!hashed.ok) {
    return hashed;
  }

  let physicalRoot: string;
  try {
    physicalRoot = realpathSync(options.monorepoRoot);
  } catch {
    return { ok: false, reason: `could not resolve ${options.monorepoRoot}` };
  }
  if (hashed.toplevel !== physicalRoot) {
    return { ok: false, reason: `the monorepo root is not the git toplevel (${hashed.toplevel})` };
  }

  return { ok: true, snapshot: { hash: hashed.hash, headSha: hashed.headSha } };
}

/** Records a pass, replacing whatever this command last recorded at this scope. */
export async function writeCheckCacheEntry(options: {
  anchorDir: string;
  command: string;
  entry: CheckCacheEntry;
  monorepoRoot: string;
}): Promise<void> {
  await writeCacheEntry(resolveEntryPath(options), JSON.stringify(options.entry, undefined, 2));
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

/** A recorded pass as it parses, before the retention beside it has been vouched for. */
type ParsedCheckCacheEntry = Omit<CheckCacheEntry, 'retention'> & { retention?: unknown };

/** Renders each variable's presence and its value separately, so an unset variable and an empty one differ. */
function composeEnvParts(names: readonly string[], env: NodeJS.ProcessEnv): string[] {
  return names.flatMap((name) => {
    const value = env[name];
    return [name, value === undefined ? 'unset' : 'set', value ?? ''];
  });
}

/** Reads a snapshot a parent process encoded, or `undefined` when the value is absent or malformed. */
function decodeTreeSnapshot(encoded: string | undefined): TreeSnapshot | undefined {
  if (encoded === undefined) {
    return undefined;
  }

  const [hash, headSha] = encoded.split(' ', 2);
  if (hash === undefined || headSha === undefined || hash === '' || headSha === '') {
    return undefined;
  }

  return { hash, headSha };
}

/**
 * Names the kind of channel a stream ran on. The descriptor number is left out: it names which terminal a
 * command wrote to, not whether what it wrote was a transcript.
 */
function describeChannel(channel: OutputChannel): string {
  return channel === 'pipe' ? 'pipe' : 'descriptor';
}

/** Folds an ordered list of ingredients into one digest, delimiting them so two lists cannot collide. */
function digestParts(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
    hash.update('\0');
  }

  return hash.digest('hex');
}

/**
 * Narrows a parsed entry, so that one written by an older format reads as a miss rather than as a pass. The
 * timestamp has to parse and the duration has to be finite, because a recalled pass spends both on its verdict:
 * an entry that would render as `passed NaNs ago` is one no reader can act on.
 *
 * The retention an entry may carry is left unread here, so that what a skip replays cannot decide whether the
 * pass beneath it stands.
 */
function isParsedCheckCacheEntry(value: unknown): value is ParsedCheckCacheEntry {
  if (!isObject(value)) {
    return false;
  }

  const stringFields = ['key', 'treeHash', 'headSha', 'commandString', 'nmrVersion', 'nodeVersion', 'recordedAt'];
  if (stringFields.some((field) => typeof value[field] !== 'string')) {
    return false;
  }

  return (
    typeof value['durationMs'] === 'number' &&
    Number.isFinite(value['durationMs']) &&
    !Number.isNaN(Date.parse(String(value['recordedAt']))) &&
    isStringRecord(value['buildDigests'])
  );
}

/**
 * Reports whether a package's build output is nmr's own to look for: neither its `build` nor its `compile` is
 * overridden by the package itself. Either overridden, and the package emits on terms this does not know, so
 * demanding a `dist` would make every run a miss.
 */
function isProbeSubject(packageDir: string, registry: ScriptRegistry): boolean {
  const build = resolveScript('build', registry, packageDir, false);
  if (build === undefined || build.origin.tier === 'package') {
    return false;
  }

  const compile = resolveScript('compile', registry, packageDir, false);

  return compile !== undefined && renderChain(compile.steps) === BUILT_IN_COMPILE;
}

/** Narrows a recorded replay line, whose three fields a rendered line spends in full. */
function isReplayLine(value: unknown): value is ReplayLine {
  return (
    isObject(value) &&
    typeof value['command'] === 'string' &&
    typeof value['excerpt'] === 'string' &&
    typeof value['scope'] === 'string'
  );
}

/** Narrows recorded retention, so an entry claiming an excerpt it cannot produce reads as a miss. */
function isRetention(value: unknown): value is Retention {
  return (
    isObject(value) &&
    typeof value['key'] === 'string' &&
    typeof value['runId'] === 'string' &&
    Array.isArray(value['replay']) &&
    value['replay'].every((line) => isReplayLine(line))
  );
}

/**
 * Locates one command's entry, or the transcript beside it. Every entry in a monorepo lives in one directory,
 * keyed by the scope and the command, so a single removal clears the whole table however many packages
 * recorded into it. The pair shares one digest, differing only in extension.
 */
function resolveEntryPath(options: EntryRef, extension: '.json' | '.log' = '.json'): string {
  const anchorDir = path.resolve(options.anchorDir);
  const ref: CacheEntryRef = {
    tool: CACHE_TOOL,
    scopeDir: options.monorepoRoot,
    slug: `${path.basename(anchorDir)}-${options.command.replaceAll(UNSAFE_SLUG_CHARACTERS, '-')}`,
    extension,
    discriminators: [anchorDir, options.command],
  };

  return resolveCacheEntryPath(ref);
}

/**
 * Digests what pnpm has installed, so that an install, a prune, or a lockfile change forces a re-run. Reports
 * a reason instead when either file is missing, which is how a non-pnpm layout disables the gate rather than
 * certifying passes over dependencies it cannot see.
 */
function resolveInstallFingerprint(
  monorepoRoot: string,
): { ok: true; fingerprint: string } | { ok: false; reason: string } {
  const hash = createHash('sha256');

  for (const relativePath of INSTALL_FINGERPRINT_FILES) {
    try {
      hash.update(readFileSync(path.join(monorepoRoot, relativePath)));
    } catch {
      return { ok: false, reason: `no install fingerprint: ${relativePath} is unreadable` };
    }
    hash.update('\0');
  }

  return { ok: true, fingerprint: hash.digest('hex') };
}

// endregion | Helpers
