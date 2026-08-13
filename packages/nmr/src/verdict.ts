import type { Writable } from 'node:stream';

import type { ReplayLine } from './check-cache.ts';
import { clampToBytes } from './helpers/clampToBytes.ts';
import { formatDuration, formatSaving } from './helpers/duration.ts';
import type { ReportFormat } from './report-format.ts';

/**
 * The ceiling a rendered verdict, its newline included, is held to.
 *
 * POSIX guarantees a write at or below `PIPE_BUF` reaches a pipe whole, and 512 is the smallest bound the
 * standard permits, so one write of a line this size cannot be interleaved by a concurrent scope under
 * `pnpm --recursive`. No Node API reports the platform's own bound, and a per-platform table would move the
 * truncation point from one machine to the next. The ceiling governs pipes: a terminal offers no such
 * guarantee at any size.
 */
export const VERDICT_LINE_LIMIT = 512;

/**
 * What a command nmr ran came to, holding the facts a reporting line is rendered from rather than the line
 * itself, so a machine-readable rendering spends the same record a human-readable one does.
 *
 * A recalled pass carries its saving as a duration and not as a decision about whether to mention it: whether
 * one is worth naming belongs to rendering, and a consumer bypassing the renderer inherits neither the
 * threshold nor an obligation to restate it.
 */
export type Verdict = { command: string; scope: string } & VerdictOutcome;

/**
 * How a command ended, together with the facts that ending carries and no other does, and the trailing detail
 * a line reserves room for.
 *
 * A recalled pass carries the excerpts it replays rather than a composed detail string, so the marker naming
 * them a recording, and the ceiling they are held to, stay with the module that owns the line's grammar.
 */
export type VerdictOutcome = { detail?: string } & (
  | { outcome: 'passed'; durationMs: number }
  | { outcome: 'failed'; durationMs: number; exitCode: number }
  | { outcome: 'recalled'; ageMs: number; savedMs: number; replay?: ReplayLine[] }
  | { outcome: 'no-op'; reason: 'empty-override' | 'noop-override' }
);

/**
 * Renders a verdict as the line nmr reports it on, without the newline that terminates it.
 *
 * The line ends without terminal punctuation and reserves its tail for `detail`, so a later change appends to
 * the grammar rather than rewriting it. A detail carrying nothing but line breaks takes its whole clause with
 * it, rather than leaving a separator pointing at nothing.
 */
export function renderVerdict(verdict: Verdict): string {
  const { icon, phrase } = describeOutcome(verdict);
  const detail = flattenDetail(verdict.detail ?? renderReplay(verdict) ?? '');
  const detailClause = detail === '' ? '' : ` — ${detail}`;

  return clampToBytes(`${icon} ${verdict.scope}: ${verdict.command}: ${phrase}${detailClause}`, LINE_BUDGET_BYTES);
}

/**
 * Renders a verdict as the JSON object a machine consumer reads, without the newline that terminates it.
 *
 * Held to the ceiling the prose line is held to, so one write still reaches a pipe whole where concurrent
 * scopes share a descriptor. A record that overruns is cut inside its text -- the excerpts a replay carries
 * and the detail slot -- rather than across its structure, which is what leaves the line parseable. Each pass
 * cuts the longest of them, so an assembly loses excerpt text before it loses a constituent, where the prose
 * line composes the whole assembly and then drops its tail. A record overrunning with every one of them
 * emptied surrenders them outright, leaving the scope, the command, and the facts the outcome carries, none
 * of which can be cut without describing a run that did not happen.
 */
export function serializeVerdict(verdict: Verdict): string {
  let candidate = verdict;
  let rendered = JSON.stringify(candidate);

  while (Buffer.byteLength(rendered) > LINE_BUDGET_BYTES) {
    const shortened = shortenLongestText(candidate, Buffer.byteLength(rendered) - LINE_BUDGET_BYTES);
    if (shortened === undefined) {
      return renderWithoutCuttableText(candidate);
    }
    candidate = shortened;
    rendered = JSON.stringify(candidate);
  }

  return rendered;
}

/**
 * Writes a verdict to a stream as a single write, which is what holds a line together when concurrent scopes
 * share one descriptor. Both renderings spend the one record, so neither can come to report what the other
 * does not.
 */
export function writeVerdict(verdict: Verdict, stream: Writable, format: ReportFormat): void {
  const line = format === 'json' ? serializeVerdict(verdict) : renderVerdict(verdict);

  stream.write(`${line}\n`);
}

// region | Helpers

/** How much of the ceiling the newline `writeVerdict` appends spends. */
const NEWLINE_BYTES = 1;

/** What a rendered line may spend, the newline `writeVerdict` appends already taken out of the ceiling. */
const LINE_BUDGET_BYTES = VERDICT_LINE_LIMIT - NEWLINE_BYTES;

/** Marks the detail as a recording of an earlier run rather than as what this invocation produced. */
const REPLAY_MARKER = 'replayed:';

/** Returns the icon a verdict leads with and the phrase it reports, which no other module composes. */
function describeOutcome(verdict: Verdict): { icon: string; phrase: string } {
  switch (verdict.outcome) {
    case 'passed':
      return { icon: '✅', phrase: `passed in ${formatDuration(verdict.durationMs)}` };
    case 'failed':
      return {
        icon: '❌',
        phrase: `failed in ${formatDuration(verdict.durationMs)} (exit ${verdict.exitCode})`,
      };
    case 'recalled': {
      const saving = formatSaving(verdict.savedMs);
      const savingClause = saving === undefined ? '' : `, ${saving}`;
      return { icon: '⏭️', phrase: `passed ${formatDuration(verdict.ageMs)} ago on this tree${savingClause}` };
    }
    case 'no-op':
      return {
        icon: '⛔',
        phrase: `skipped, the override is ${verdict.reason === 'empty-override' ? 'empty' : 'a no-op'}`,
      };
    default: {
      const unhandled: never = verdict;
      throw new Error(`Unhandled verdict outcome: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * Renders a recalled pass's replay for the detail slot, or `undefined` when there is nothing to replay.
 *
 * An excerpt the verdict's own scope and command already name drops its attribution, which is the leaf whose
 * output the line is. Every other line keeps the attribution naming where it came from, so a composite
 * replaying one constituent's excerpt does not present it as its own.
 */
function renderReplay(verdict: Verdict): string | undefined {
  if (verdict.outcome !== 'recalled' || verdict.replay === undefined || verdict.replay.length === 0) {
    return undefined;
  }

  const [first] = verdict.replay;
  if (verdict.replay.length === 1 && first?.command === verdict.command && first.scope === verdict.scope) {
    return `${REPLAY_MARKER} ${first.excerpt}`;
  }

  const lines = verdict.replay.map((line) => `${line.scope}: ${line.command}: ${line.excerpt}`);

  return `${REPLAY_MARKER} ${lines.join('; ')}`;
}

/**
 * Collapses a detail's line breaks into single spaces, so one verdict stays one line.
 *
 * A detail is text lifted from a command's output, which is where line breaks live. The byte ceiling is held
 * here rather than at the call site for the same reason a line's shape is: both belong to the module that owns
 * the grammar, not to whoever fills the slot.
 */
function flattenDetail(detail: string): string {
  return detail.replaceAll(/[\r\n]+/gu, ' ').trim();
}

/**
 * Renders the record with everything cuttable gone, which is what a record still overrunning the ceiling with
 * every one of them emptied is left with.
 */
function renderWithoutCuttableText(verdict: Verdict): string {
  const record: Record<string, unknown> = { ...verdict };
  delete record['detail'];
  delete record['replay'];

  return JSON.stringify(record);
}

/**
 * Returns the verdict with its longest cuttable string shortened by at least the overrun, or `undefined` when
 * every one of them is already empty and there is nothing left to give.
 *
 * Shortening by the overrun is what makes the loop that calls this terminate: dropping raw content drops at
 * least as many bytes from the rendering, since escaping only ever adds to what a character costs there.
 */
function shortenLongestText(verdict: Verdict, overrunBytes: number): Verdict | undefined {
  const detailSize = Buffer.byteLength(verdict.detail ?? '');

  if (verdict.outcome === 'recalled' && verdict.replay !== undefined) {
    const sizes = verdict.replay.map((line) => Buffer.byteLength(line.excerpt));
    const longest = Math.max(0, ...sizes);
    if (longest > 0 && longest >= detailSize) {
      const target = sizes.indexOf(longest);
      const replay = verdict.replay.map((line, position) =>
        position === target ? { ...line, excerpt: shortenText(line.excerpt, overrunBytes) } : line,
      );

      return { ...verdict, replay };
    }
  }

  if (verdict.detail === undefined || detailSize === 0) {
    return undefined;
  }

  return { ...verdict, detail: shortenText(verdict.detail, overrunBytes) };
}

/** Cuts at least the overrun off a string, which the caller has established is not already empty. */
function shortenText(value: string, overrunBytes: number): string {
  return clampToBytes(value, Math.max(0, Buffer.byteLength(value) - overrunBytes));
}

// endregion | Helpers
