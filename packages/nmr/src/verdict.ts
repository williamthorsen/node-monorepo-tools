import type { Writable } from 'node:stream';

import type { ReplayLine } from './check-cache.ts';
import { clampToBytes, TRUNCATION_MARK } from './helpers/clampToBytes.ts';
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
 * scopes share a descriptor. Cuts land inside the record's text rather than across its structure, which is
 * what leaves the line parseable, and a record is fitted by rungs, each shedding what a reader can better
 * spare than the rung below it. What the ceiling costs is [documented](../README.md#reporting-for-a-machine)
 * in the same order.
 */
export function serializeVerdict(verdict: Verdict): string {
  const rendered = JSON.stringify(verdict);

  return isWithinBudget(rendered) ? rendered : renderWithinBudget(verdict);
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

/** What a cut never takes a string below, so every string that was cut still carries the mark saying so. */
const MIN_CUT_BYTES = Buffer.byteLength(TRUNCATION_MARK);

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
 * Returns the size to cut the longest of a set of strings down to, so that cutting each in turn brings the set
 * level rather than spending the whole overrun on the first string reached.
 *
 * The target is the next size another string holds; where none does, because every string is already that
 * size, it is this string's share of what is still owed. A string at or below the mark is no size to level
 * toward -- counting one, as the empty detail slot would be every time, puts the target at the mark and
 * collapses the whole set on the first pass.
 */
function findCutTarget(sizes: readonly number[], longest: number, overrunBytes: number): number {
  const below = sizes.filter((size) => size < longest && size > MIN_CUT_BYTES);
  const share = Math.ceil(overrunBytes / sizes.filter((size) => size === longest).length);
  const target = below.length === 0 ? longest - share : Math.max(...below, longest - overrunBytes);

  return Math.max(MIN_CUT_BYTES, target);
}

/** Reports whether a rendered line, once the newline is counted, sits inside the ceiling. */
function isWithinBudget(rendered: string): boolean {
  return Buffer.byteLength(rendered) <= LINE_BUDGET_BYTES;
}

/** Returns what each constituent of a replay is, with the excerpt it carried gone. */
function readAttribution(verdict: Verdict): { command: string; scope: string }[] {
  if (verdict.outcome !== 'recalled' || verdict.replay === undefined) {
    return [];
  }

  return verdict.replay.map((line) => ({ command: line.command, scope: line.scope }));
}

/**
 * Returns the strings a cut can take from, in the order an index addresses them: the detail slot, and then
 * each constituent's excerpt.
 */
function readCuttableText(verdict: Verdict): string[] {
  const excerpts =
    verdict.outcome === 'recalled' && verdict.replay !== undefined ? verdict.replay.map((line) => line.excerpt) : [];

  return [verdict.detail ?? '', ...excerpts];
}

/**
 * Cuts the scope and the command, which is all a record has left to give once every structure above them is
 * gone. Each is marked, as the prose line marks the same fields when it clamps.
 */
function renderClamped(record: Record<string, unknown>): string {
  const clamped = { ...record };
  let rendered = JSON.stringify(clamped);

  while (!isWithinBudget(rendered)) {
    const fields = ['command', 'scope'];
    const sizes = fields.map((field) => Buffer.byteLength(typeof clamped[field] === 'string' ? clamped[field] : ''));
    const longest = Math.max(...sizes);
    if (longest <= MIN_CUT_BYTES) {
      return rendered;
    }

    const target = findCutTarget(sizes, longest, Buffer.byteLength(rendered) - LINE_BUDGET_BYTES);
    const field = fields[sizes.indexOf(longest)] ?? 'command';
    clamped[field] = clampToBytes(typeof clamped[field] === 'string' ? clamped[field] : '', target);
    rendered = JSON.stringify(clamped);
  }

  return rendered;
}

/**
 * Fits a record that overran the ceiling, by rungs.
 *
 * Each rung sheds what a reader can better spare than the rung below it: the excerpts are shortened toward one
 * another until they fit or every one sits at the mark; then they go, leaving the scope and command that name
 * each constituent; then the constituents themselves go from the end, as the prose line drops its own tail;
 * and last the scope and the command are cut, because a line that overruns can be split across a pipe and
 * corrupt the records of every scope sharing it, where a marked cut costs only its own.
 */
function renderWithinBudget(verdict: Verdict): string {
  const shortened = shortenCuttableText(verdict);
  const shortenedLine = JSON.stringify(shortened);
  if (isWithinBudget(shortenedLine)) {
    return shortenedLine;
  }

  const record: Record<string, unknown> = { ...shortened };
  delete record['detail'];

  const attribution = readAttribution(shortened);
  for (let kept = attribution.length; kept > 0; kept--) {
    record['replay'] = attribution.slice(0, kept);
    const rendered = JSON.stringify(record);
    if (isWithinBudget(rendered)) {
      return rendered;
    }
  }

  delete record['replay'];
  const bare = JSON.stringify(record);

  return isWithinBudget(bare) ? bare : renderClamped(record);
}

/**
 * Shortens the record's cuttable strings toward one another until they fit or every one sits at the mark.
 *
 * Cutting the longest down toward the next-longest is what spreads the overrun over the whole assembly rather
 * than spending it on whichever constituent happens to be listed first, and the floor at the mark is what
 * leaves every cut string distinguishable from one that recorded nothing.
 */
function shortenCuttableText(verdict: Verdict): Verdict {
  let candidate = verdict;
  let rendered = JSON.stringify(candidate);

  while (!isWithinBudget(rendered)) {
    const shortened = shortenLongestText(candidate, Buffer.byteLength(rendered) - LINE_BUDGET_BYTES);
    if (shortened === undefined) {
      return candidate;
    }
    candidate = shortened;
    rendered = JSON.stringify(candidate);
  }

  return candidate;
}

/**
 * Returns the verdict with its longest cuttable string cut toward the next-longest, or `undefined` when every
 * one of them already sits at the mark and there is nothing left to give.
 *
 * The cut is always a strict shortening, bounded below by the mark, which is what makes the loop calling this
 * terminate.
 */
function shortenLongestText(verdict: Verdict, overrunBytes: number): Verdict | undefined {
  const texts = readCuttableText(verdict);
  const sizes = texts.map((text) => Buffer.byteLength(text));
  const longest = Math.max(...sizes);
  if (longest <= MIN_CUT_BYTES) {
    return undefined;
  }

  const index = sizes.indexOf(longest);
  const target = findCutTarget(sizes, longest, overrunBytes);

  return writeCuttableText(verdict, index, clampToBytes(texts[index] ?? '', target));
}

/** Returns the verdict with one of its cuttable strings replaced, addressed as `readCuttableText` orders them. */
function writeCuttableText(verdict: Verdict, index: number, value: string): Verdict {
  if (index === 0) {
    return { ...verdict, detail: value };
  }
  if (verdict.outcome !== 'recalled' || verdict.replay === undefined) {
    return verdict;
  }

  const replay = verdict.replay.map((line, position) => (position === index - 1 ? { ...line, excerpt: value } : line));

  return { ...verdict, replay };
}

// endregion | Helpers
