import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type { TreeSnapshot } from './check-cache.ts';
import type { OutputChannel, OutputChannels } from './output-channel.ts';

/** The parts of the running interpreter that can change what a check concludes. */
export interface RuntimeIdentity {
  arch: string;
  nodeVersion: string;
  platform: string;
}

/** The interpreter on which this process is running, folded into every key and recorded alongside every pass. */
export const CURRENT_RUNTIME: RuntimeIdentity = {
  arch: process.arch,
  nodeVersion: process.version,
  platform: process.platform,
};

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

// region | Helpers

/** Renders each variable's presence and its value separately, so that an unset variable and an empty one differ. */
function composeEnvParts(names: readonly string[], env: NodeJS.ProcessEnv): string[] {
  return names.flatMap((name) => {
    const value = env[name];
    return [name, value === undefined ? 'unset' : 'set', value ?? ''];
  });
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
