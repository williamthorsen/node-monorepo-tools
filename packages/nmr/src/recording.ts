import type { CheckCacheEntry } from './check-cache.ts';
import { readCheckCacheEntry, readTranscript } from './check-cache.ts';
import { formatDuration } from './helpers/duration.ts';

/**
 * What this invocation would be recorded under, insofar as an entry records the same facts. A mismatch is read
 * against these, so a refusal names the ingredient that moved rather than blaming the tree for all of them.
 */
export interface RunIdentity {
  commandString: string;
  nmrVersion: string;
  nodeVersion: string;
  /** Absent where no snapshot was taken, which leaves the tree unattributable rather than assumed equal. */
  treeHash: string | undefined;
}

/** A recorded pass and what it left a reader: its command's own transcript, or the assembly a composite holds. */
export interface Recording {
  entry: CheckCacheEntry;
  /** What the command wrote, absent on a composite, which retains nothing of its own. */
  transcript?: string;
}

/**
 * Which of the pass key's ingredients a recorded pass and this invocation disagree on, insofar as an entry
 * records enough to tell: the residual covers what it does not, which is the install, the platform, and the
 * environment variables the key folds in.
 */
export type KeyDifference =
  | { ingredient: 'tree' }
  | { ingredient: 'command-string' }
  | { ingredient: 'nmr-version'; current: string; recorded: string }
  | { ingredient: 'node-version'; current: string; recorded: string }
  | { ingredient: 'other' };

/** What `--log` found for one command at one scope. */
export type RecordingLookup = { ok: true; recording: Recording } | { ok: false; refusal: RecordingRefusal };

/**
 * Why there is nothing to print. Each is a separate answer to a reader asking for the last run's output, and
 * each names a different next move: run the command, run it on this tree, run it through a pipe, or stop
 * asking for a command no run records.
 */
export type RecordingRefusal =
  | { kind: 'uncacheable' }
  | { kind: 'gate-aside' }
  | { kind: 'unrecorded' }
  | { kind: 'mismatched'; ageMs: number; difference: KeyDifference }
  | { kind: 'no-output'; ageMs: number };

/**
 * Renders a recording as the reader sees it: a header dating what follows, the command string that produced
 * it, and then the run's own bytes.
 *
 * The header is what presents the body as a recording rather than as this invocation's output, which is what
 * lets a reader at a terminal be shown what a piped run wrote. The command string is the whole chain, hooks
 * included, so the header names what earned the pass and not merely what was typed.
 */
export function renderRecording(options: { command: string; recording: Recording; scope: string }): string {
  const { entry } = options.recording;
  const age = formatDuration(Math.max(0, Date.now() - Date.parse(entry.recordedAt)));
  const header =
    `📼 ${options.scope}: ${options.command} — recorded ${entry.recordedAt} (${age} ago), ` +
    `ran in ${formatDuration(entry.durationMs)}\n$ ${entry.commandString}\n\n`;

  return `${header}${appendNewline(renderBody(options.recording))}`;
}

/**
 * Renders a refusal on the one line a fan-out can attribute, in the grammar a verdict uses: the scope, the
 * command, and what is missing.
 */
export function renderRefusal(options: { command: string; refusal: RecordingRefusal; scope: string }): string {
  return `📭 ${options.scope}: ${options.command}: no recording; ${describeRefusal(options.command, options.refusal)}`;
}

/**
 * Resolves what one scope has to show for one command.
 *
 * Admitted on the pass key alone, so `--log` prints exactly what a skip would have recalled and never a
 * recording of some other tree. The retention key is deliberately not consulted: it certifies that a recording
 * describes this presentation environment, which is what a replayed excerpt needs and what a dated recording
 * does not.
 */
export async function resolveRecording(options: {
  anchorDir: string;
  command: string;
  current: RunIdentity;
  isCacheable: boolean;
  key: string | undefined;
  monorepoRoot: string;
}): Promise<RecordingLookup> {
  const { anchorDir, command, monorepoRoot } = options;

  if (!options.isCacheable) {
    return { ok: false, refusal: { kind: 'uncacheable' } };
  }
  if (options.key === undefined) {
    return { ok: false, refusal: { kind: 'gate-aside' } };
  }

  const entry = await readCheckCacheEntry({ anchorDir, command, monorepoRoot });
  if (entry === undefined) {
    return { ok: false, refusal: { kind: 'unrecorded' } };
  }

  const ageMs = Math.max(0, Date.now() - Date.parse(entry.recordedAt));
  if (entry.key !== options.key) {
    return { ok: false, refusal: { kind: 'mismatched', ageMs, difference: findKeyDifference(entry, options.current) } };
  }

  const transcript = await readTranscript({ anchorDir, command, monorepoRoot });
  if (transcript === undefined && (entry.retention?.replay.length ?? 0) === 0) {
    return { ok: false, refusal: { kind: 'no-output', ageMs } };
  }

  return { ok: true, recording: { entry, ...(transcript !== undefined && { transcript }) } };
}

// region | Helpers

/** Terminates a body that does not terminate itself, so a recording never runs into the next prompt. */
function appendNewline(body: string): string {
  return body.endsWith('\n') ? body : `${body}\n`;
}

/** Returns the clause naming what a recorded pass and this invocation disagree on. */
function describeDifference(difference: KeyDifference): string {
  switch (difference.ingredient) {
    case 'tree':
      return 'on a tree this is not';
    case 'command-string':
      return 'over a command chain this is not';
    case 'nmr-version':
      return `under nmr ${difference.recorded}, not ${difference.current}`;
    case 'node-version':
      return `under Node ${difference.recorded}, not ${difference.current}`;
    case 'other':
      return 'under an install or environment this run does not share';
    default: {
      const unhandled: never = difference;
      throw new Error(`Unhandled key difference: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Returns the clause a refusal spends on why there is nothing to print. */
function describeRefusal(command: string, refusal: RecordingRefusal): string {
  switch (refusal.kind) {
    case 'uncacheable':
      return `\`${command}\` is outside the check-result cache, so no run of it is recorded`;
    case 'gate-aside':
      return 'the check-result cache is standing aside here (NMR_DEBUG=1 reports why)';
    case 'unrecorded':
      return 'nothing has recorded a pass for this scope';
    case 'mismatched':
      return `the last pass was ${formatDuration(refusal.ageMs)} ago, ${describeDifference(refusal.difference)}`;
    case 'no-output':
      return `the pass ${formatDuration(refusal.ageMs)} ago retained none, as a run printing nothing or writing to a terminal does`;
    default: {
      const unhandled: never = refusal;
      throw new Error(`Unhandled refusal: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * Names the first ingredient a recorded pass and this invocation disagree on, in the order a reader would
 * check them: the tree, then the chain that would run, then the versions the key folds in.
 */
function findKeyDifference(entry: CheckCacheEntry, current: RunIdentity): KeyDifference {
  if (current.treeHash !== undefined && entry.treeHash !== current.treeHash) {
    return { ingredient: 'tree' };
  }
  if (entry.commandString !== current.commandString) {
    return { ingredient: 'command-string' };
  }
  if (entry.nmrVersion !== current.nmrVersion) {
    return { ingredient: 'nmr-version', current: current.nmrVersion, recorded: entry.nmrVersion };
  }
  if (entry.nodeVersion !== current.nodeVersion) {
    return { ingredient: 'node-version', current: current.nodeVersion, recorded: entry.nodeVersion };
  }

  return { ingredient: 'other' };
}

/**
 * Returns what a recording prints below its header: a leaf's own transcript, and otherwise the excerpts a
 * composite assembled, each attributed to the scope and command that produced it.
 *
 * The attribution is kept even where one line's own scope and command are the header's, which the verdict
 * line drops: a reader of several lines needs every one of them to say where it came from.
 */
function renderBody(recording: Recording): string {
  if (recording.transcript !== undefined) {
    return recording.transcript;
  }

  return (recording.entry.retention?.replay ?? [])
    .map((line) => `${line.scope}: ${line.command}: ${line.excerpt}`)
    .join('\n');
}

// endregion | Helpers
