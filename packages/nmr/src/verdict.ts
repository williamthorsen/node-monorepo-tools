import type { Writable } from 'node:stream';

import type { ReplayLine } from './check-cache.ts';
import { formatDuration, formatSaving } from './helpers/duration.ts';

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

  return clampToLimit(`${icon} ${verdict.scope}: ${verdict.command}: ${phrase}${detailClause}`);
}

/**
 * Writes a verdict to a stream as a single write, which is what holds a line together when concurrent scopes
 * share one descriptor.
 */
export function writeVerdict(verdict: Verdict, stream: Writable): void {
  stream.write(`${renderVerdict(verdict)}\n`);
}

// region | Helpers

/** How much of the ceiling the newline `writeVerdict` appends spends. */
const NEWLINE_BYTES = 1;

/** Marks the detail as a recording of an earlier run rather than as what this invocation produced. */
const REPLAY_MARKER = 'replayed:';

/** Marks a line that was cut, so a reader can tell a truncated verdict from a complete one. */
const TRUNCATION_MARK = '…';

/**
 * Cuts a line that would overrun the ceiling, marking the cut.
 *
 * Cuts between code points rather than between bytes: `⏭️` is two of them, and a byte cut landing inside one
 * would put a partial character on the wire. Graphemes are left unconsidered, which can separate an emoji from
 * a modifier following it -- a cost this pays only on a line nothing today comes near producing.
 */
function clampToLimit(line: string): string {
  if (Buffer.byteLength(line) + NEWLINE_BYTES <= VERDICT_LINE_LIMIT) {
    return line;
  }

  const budget = VERDICT_LINE_LIMIT - NEWLINE_BYTES - Buffer.byteLength(TRUNCATION_MARK);
  let kept = '';
  let bytes = 0;

  for (const character of line) {
    const size = Buffer.byteLength(character);
    if (bytes + size > budget) break;
    kept += character;
    bytes += size;
  }

  return `${kept}${TRUNCATION_MARK}`;
}

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
 * A single excerpt drops its attribution, which the verdict's own scope and command already carry. Where
 * several scopes contributed, each excerpt keeps the attribution naming the one it came from.
 */
function renderReplay(verdict: Verdict): string | undefined {
  if (verdict.outcome !== 'recalled' || verdict.replay === undefined || verdict.replay.length === 0) {
    return undefined;
  }

  const [first] = verdict.replay;
  if (verdict.replay.length === 1 && first !== undefined) {
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

// endregion | Helpers
