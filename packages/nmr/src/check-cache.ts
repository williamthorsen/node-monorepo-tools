import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { Writable } from 'node:stream';

import {
  type CacheEntryRef,
  hashWorkingTree,
  type OutputStyle,
  readCacheEntry,
  readHeadSha,
  readJsonCacheEntry,
  removeCacheDir,
  removeCacheEntry,
  resolveCacheEntryPath,
  STATUS_GLYPHS,
  writeCacheEntry,
} from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { hasBuildOutput, readBuildDigest } from './commands/build-output.ts';
import { loadWorkspaceConfig } from './config.ts';
import { isHookName } from './helpers/hook-name.ts';
import { isObject, isStringRecord } from './helpers/type-guards.ts';
import { getDefaultWorkspaceScripts, type ScriptRegistry } from './resolve-scripts.ts';
import { buildWorkspaceRegistry, resolveScript } from './resolver.ts';
import type { OutputChannel, OutputChannels } from './runner.ts';
import { renderChain } from './steps.ts';
import type { CheckCacheConfig, NmrConfig } from './types.ts';
import { getWorkspacePackageDirs } from './workspace.ts';

/** A recorded pass: what ran, on which tree, and how long it took. */
export interface CheckCacheEntry {
  /** The full cache key under which the pass was recorded; a hit is this key matching the key computed now. */
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
   * The build digest that each covered package's output had when the pass was recorded. Build output is
   * git-ignored, so the tree hash cannot describe it; comparing these separates output built from this tree from
   * output that another tree left behind.
   */
  buildDigests: Record<string, string>;
  /** What a skip replays in place of the run that it recalls, absent on a pass that retained nothing. */
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
 * A list rather than one excerpt: a composite's entry contains its constituents' lines, and a nested one's are
 * spliced into its parent's, where the attribution cannot be re-derived from the entry that contains them.
 *
 * The witness admits a constituent's line into the assembly that its parent records: a run writes it when it
 * records an excerpt, and restamps it when it recalls one and replays it.
 */
export interface Retention {
  key: string;
  replay: ReplayLine[];
  runId: string;
}

/** What nmr's own build has left on disk across the workspace. */
export interface BuildOutputState {
  /** Covered packages whose output is absent. */
  missingPackages: string[];
  /** The digest of the inputs from which each covered package's output was built, keyed by package name. */
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

/** The interpreter on which this process is running, folded into every key and recorded alongside every pass. */
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

/** The default `compile` script: nmr's own build. */
const BUILT_IN_COMPILE = 'nmr-compile';

/** The tool whose cache directory stores check results. */
const CACHE_TOOL = 'nmr-check';

/**
 * The pnpm files that together describe what is installed. Both are internal to pnpm; either one going missing
 * disables the gate, which is the safe direction, and a pnpm release that moves them has the same effect.
 */
const INSTALL_FINGERPRINT_FILES = [
  path.join('node_modules', '.modules.yaml'),
  path.join('node_modules', '.pnpm', 'lock.yaml'),
];

/** Names the fold. Bump it whenever an ingredient is added or removed, so that older entries read as misses. */
const KEY_FORMAT = 'nmr-check-cache-v1';

/**
 * Environment variables through which a check can reach a different conclusion. The list is fixed, so that two
 * machines that differ only in shell decoration compute the same key; a command that reads another variable
 * belongs in `excludeCommands`.
 */
const KEYED_ENV_VARS = ['LANG', 'LC_ALL', 'NODE_OPTIONS', 'TZ'];

/** Names the retention fold. Bump it to invalidate retained excerpts without invalidating a single pass. */
const RETENTION_KEY_FORMAT = 'nmr-retention-v1';

/**
 * Environment variables that a tool reads to decide how to present itself. They change what a transcript looks
 * like without changing what the command concludes, so they belong to the retention key alone: a run under a
 * different terminal width recalls the same pass and declines to replay its excerpt.
 *
 * `NMR_OUTPUT_STYLE` is not among them, for the reason `output-style.ts` states: a run does not decline any
 * recording over a style, and replays a rich excerpt in a plain run as it replays a plain one in a rich run.
 */
const RETENTION_KEYED_ENV_VARS = ['CI', 'COLUMNS', 'FORCE_COLOR', 'NO_COLOR', 'TERM'];

/** Characters that a command name may contribute to a file name; every other character becomes a hyphen. */
const UNSAFE_SLUG_CHARACTERS = /[^\w.-]+/g;

/**
 * Restamps a recalled entry's retention with the run that is replaying it, so that an excerpt certified by this
 * run can join the assembly recorded by a composite above it.
 *
 * A recall certifies as surely as a recording does. Because the pass key matched, the excerpt describes this
 * tree; because the caller calls this only when the retention key matched too, the excerpt also describes this
 * presentation environment. Everything else the entry records stands -- the instant and the duration belong to
 * the run that earned the pass, and a recall must not make it read as later or longer than it was.
 *
 * A cache that cannot be written is not worth failing a green run over: `certifyRetention` reports that failure
 * in the debug note.
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
 * string that would run, the scope in which it would run, nmr's own version, the interpreter, what is installed,
 * and the environment variables that a check can read. A hit is this key matching a recorded one, so an ingredient left
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
 * Folds what changes a transcript without changing a conclusion onto the pass key: the channel on which each of
 * the command's output streams ran, and the environment variables through which a tool presents itself.
 *
 * The channel kind keeps a run at a terminal from replaying a piped recording. It is the channel's kind and not
 * whether a terminal is attached: under quiet mode the child writes to pipes at a terminal, and its transcript
 * is reproducible.
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
 * the output that the earlier observation describes is not the output that the later one found.
 */
export function findStaleBuildOutput(
  earlierDigests: Record<string, string>,
  laterDigests: Record<string, string>,
): string | undefined {
  const names = [...new Set([...Object.keys(earlierDigests), ...Object.keys(laterDigests)])].toSorted();

  return names.find((name) => earlierDigests[name] !== laterDigests[name]);
}

/**
 * Renders the warning for a `--no-cache` that appears after the command name, where it is an argument to the
 * command rather than a flag to nmr. nmr passes the argument on unchanged, so the warning is the only sign that
 * nmr did not read it.
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
 * Reads the state of the build output that nmr's own build covers. Build output is git-ignored, so the tree hash
 * says nothing about it: a `ci` whose `build` constituent is cached would otherwise skip on a tree whose `dist`
 * had been deleted, or whose `dist` was compiled from a different tree, and hand back a green exit over a
 * repository that cannot run.
 *
 * Because a package whose `build` or `compile` is overridden emits to a location that this function does not
 * know about, it is left out rather than made a permanent miss.
 */
export async function readBuildOutputState(monorepoRoot: string, config: NmrConfig): Promise<BuildOutputState> {
  const state: BuildOutputState = { missingPackages: [], digests: {} };

  let packageDirs: string[];
  try {
    packageDirs = getWorkspacePackageDirs(monorepoRoot);
  } catch {
    return state;
  }

  const registry = buildWorkspaceRegistry(config);
  // Return before reading any package: a repo that redefines `build` exempts its whole workspace.
  if (JSON.stringify(registry['build']) !== JSON.stringify(getDefaultWorkspaceScripts()['build'])) {
    return state;
  }

  for (const packageDir of packageDirs) {
    if (!isProbeSubject(packageDir, registry)) {
      continue;
    }

    // Read on the package's own build options, so that the entry set here is the one that the build actually
    // compiles. A package whose extra patterns leave nothing to emit does not expect any output, and reporting
    // it missing would make it a permanent miss that defeats the whole repo's gate.
    const { build } = await loadWorkspaceConfig(packageDir);
    const options = build?.extraIgnorePatterns === undefined ? {} : { extraIgnorePatterns: build.extraIgnorePatterns };

    // Key by the path relative to the monorepo root, the identity that `computeCacheKey` uses for a scope: a
    // workspace's globs can yield two packages with the same directory name, and each needs its own digest.
    const name = path.relative(monorepoRoot, packageDir);
    if (await hasBuildOutput(packageDir, options)) {
      state.digests[name] = (await readBuildDigest(packageDir)) ?? '';
    } else {
      state.missingPackages.push(name);
    }
  }

  return state;
}

/**
 * Reads the entry recorded for one command at one scope, or `undefined` when there is none to trust.
 *
 * Retention is vouched for separately from the pass that contains it: an excerpt of a shape that this function
 * cannot read is dropped, leaving a pass that skips cleanly and reports its verdict alone.
 */
export async function readCheckCacheEntry(options: {
  anchorDir: string;
  command: string;
  monorepoRoot: string;
}): Promise<CheckCacheEntry | undefined> {
  const parsedEntry = await readJsonCacheEntry(resolveEntryPath(options), isParsedCheckCacheEntry);
  if (parsedEntry === undefined) {
    return undefined;
  }

  const { retention, ...pass } = parsedEntry;

  return isRetention(retention) ? { ...pass, retention } : pass;
}

/**
 * Reads the whole output that one recorded pass retained, or `undefined` when it retained none.
 *
 * Held to nothing on its own: the entry beside it says which tree the bytes describe, and a caller
 * that has not matched the entry's key is reading a transcript of some other tree.
 */
export async function readTranscript(ref: EntryRef): Promise<string | undefined> {
  return readCacheEntry(resolveEntryPath(ref, '.log'));
}

/**
 * Makes the transcript beside one entry be exactly what this pass retained, removing what an earlier pass
 * left when this one retained nothing.
 *
 * A composite retains nothing of its own, so without the removal a leaf's transcript would remain beside an
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
 * stale identity to the invocations that it later makes, and the tree hash keeps that harmless, because every
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

  return { ok: true, snapshot: { hash: hashedTree.hash, headSha: hashedTree.headSha } };
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

/** Renders each variable's presence and its value separately, so that an unset variable and an empty one differ. */
function composeEnvParts(names: readonly string[], env: NodeJS.ProcessEnv): string[] {
  return names.flatMap((name) => {
    const value = env[name];
    return [name, value === undefined ? 'unset' : 'set', value ?? ''];
  });
}

/** Reads a snapshot encoded by a parent process, or `undefined` when the value is absent or malformed. */
function decodeTreeSnapshot(encodedSnapshot: string | undefined): TreeSnapshot | undefined {
  if (encodedSnapshot === undefined) {
    return undefined;
  }

  const [hash, headSha] = encodedSnapshot.split(' ', 2);
  if (hash === undefined || headSha === undefined || hash === '' || headSha === '') {
    return undefined;
  }

  return { hash, headSha };
}

/**
 * Names the kind of channel on which a stream ran. The descriptor number is left out: it names which terminal a
 * command wrote to, not whether what it wrote was a transcript.
 */
function describeChannel(channel: OutputChannel): string {
  return channel === 'pipe' ? 'pipe' : 'descriptor';
}

/** Folds an ordered list of ingredients into one digest, delimiting them so that two lists cannot collide. */
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
 * timestamp has to parse and the duration has to be finite, because a recalled pass uses both in its verdict: an
 * entry that would render as `passed NaNs ago` is one that a reader cannot act on.
 *
 * The retention that an entry may contain is left unread here, so that what a skip replays cannot decide whether the
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
 * overridden by the package itself. If either is overridden, the package emits output in a way that this
 * function does not know, so demanding a `dist` would make every run a miss.
 */
function isProbeSubject(packageDir: string, registry: ScriptRegistry): boolean {
  const build = resolveScript('build', registry, packageDir, false);
  if (build === undefined || build.origin.tier === 'package') {
    return false;
  }

  const compile = resolveScript('compile', registry, packageDir, false);

  return compile !== undefined && renderChain(compile.steps) === BUILT_IN_COMPILE;
}

/** Narrows a recorded replay line, whose three fields a rendered line uses in full. */
function isReplayLine(value: unknown): value is ReplayLine {
  return (
    isObject(value) &&
    typeof value['command'] === 'string' &&
    typeof value['excerpt'] === 'string' &&
    typeof value['scope'] === 'string'
  );
}

/** Narrows recorded retention, so that an entry claiming an excerpt that it cannot produce reads as a miss. */
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
 * Locates one command's entry, or the transcript beside it. Because every entry in a monorepo is stored in one
 * directory, keyed by the scope and the command, a single removal clears the whole table however many packages
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
