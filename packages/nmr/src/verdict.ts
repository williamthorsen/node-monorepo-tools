import type { Writable } from 'node:stream';

import { type OutputStyle, STATUS_GLYPHS } from '@williamthorsen/nmr-core';

import type { ReplayLine } from './check-cache.ts';
import { NMR_GLYPHS } from './glyphs.ts';
import { clampToBytes, TRUNCATION_MARK } from './helpers/clampToBytes.ts';
import { formatDuration, formatSaving } from './helpers/duration.ts';
import type { ReportFormat } from './report-format.ts';

/**
 * The ceiling to which a rendered verdict, its newline included, is held.
 *
 * POSIX guarantees that a write at or below `PIPE_BUF` arrives in a pipe whole, and 512 is the smallest bound that
 * the standard permits, so one write of a line this size cannot be interleaved by a concurrent scope under
 * `pnpm --recursive`. Node does not have an API that reports the platform's own bound, and a per-platform table
 * would move the truncation point from one machine to the next. The ceiling applies to pipes: A terminal does not
 * offer that guarantee at any size.
 */
export const VERDICT_LINE_LIMIT_BYTES = 512;

/**
 * Why a command ran nothing, which the `no-op` outcome includes and `--json` serializes.
 *
 * `empty-workspace` and `empty-override` both leave a chain without any step in it, so the reason tells a command
 * emptied by the workspace apart from one emptied by an override.
 */
export type NoOpReason = 'empty-override' | 'empty-workspace' | 'noop-override';

/**
 * The result of a command that nmr ran. It contains the facts from which a reporting line is rendered rather than
 * the line itself, which lets a machine-readable rendering use the same record as a human-readable one.
 *
 * A recalled pass records its saving as a duration and not as a decision about whether to mention it: Whether
 * one is worth naming belongs to rendering, and a consumer bypassing the renderer inherits neither the threshold
 * nor an obligation to restate it.
 */
export type Verdict = { command: string; scope: string } & VerdictOutcome;

/**
 * How a command ended, together with the facts specific to that ending, and the trailing detail for which a line
 * reserves room.
 *
 * A recalled pass contains the excerpts that it replays rather than a composed detail string, so that the marker
 * naming them a recording, and the ceiling to which they are held, stay with the module that owns the line's
 * grammar.
 */
export type VerdictOutcome = { detail?: string } & (
  | { outcome: 'passed'; durationMs: number }
  | { outcome: 'failed'; durationMs: number; exitCode: number }
  | { outcome: 'recalled'; ageMs: number; savedMs: number; replay?: ReplayLine[] }
  | { outcome: 'no-op'; reason: NoOpReason }
);

/**
 * Renders a verdict as the line on which nmr reports it, without the newline that terminates it.
 *
 * The line ends without terminal punctuation and reserves its tail for `detail`, so that a later change appends to
 * the grammar rather than rewriting it. When a detail contains nothing but line breaks, the line omits the detail's
 * whole clause rather than leaving a separator pointing at nothing.
 *
 * The marker does not take a padding column. Because every plain marker that a verdict uses is four characters,
 * the lines align by construction. `formatStatusLine` pads to a column that `BLOCK` widens, and a verdict is never
 * one.
 */
export function renderVerdict(verdict: Verdict, style: OutputStyle): string {
  const { marker, phrase } = describeOutcome(verdict, style);
  const detail = flattenDetail(verdict.detail ?? renderReplay(verdict) ?? '');
  const detailClause = detail === '' ? '' : ` — ${detail}`;

  return clampToBytes(`${marker} ${verdict.scope}: ${verdict.command}: ${phrase}${detailClause}`, LINE_BUDGET_BYTES);
}

/**
 * Renders a verdict as the JSON object that a machine consumer reads, without the newline that terminates it.
 *
 * Held to the same ceiling as the prose line, so that one write still arrives in a pipe whole when concurrent
 * scopes share a descriptor. It cuts inside the record's text rather than across its structure, which leaves the
 * line parseable, and fits a record by rungs, each shedding what a reader can better spare than the rung below it.
 * Each rung is [documented](../docs/reporting.md#reporting-for-a-machine) in the same order.
 */
export function serializeVerdict(verdict: Verdict): string {
  const renderedLine = JSON.stringify(verdict);

  return isWithinBudget(renderedLine) ? renderedLine : renderWithinBudget(verdict);
}

/**
 * Writes a verdict to a stream as a single write, which keeps a line intact when concurrent scopes share one
 * descriptor. Both renderings use the one record, so neither can come to report what the other does not.
 */
export function writeVerdict(verdict: Verdict, stream: Writable, format: ReportFormat, style: OutputStyle): void {
  const line = format === 'json' ? serializeVerdict(verdict) : renderVerdict(verdict, style);

  stream.write(`${line}\n`);
}

// region | Helpers

/** How much of the ceiling the newline appended by `writeVerdict` spends. */
const NEWLINE_BYTES = 1;

/** What a rendered line may spend, the newline appended by `writeVerdict` already taken out of the ceiling. */
const LINE_BUDGET_BYTES = VERDICT_LINE_LIMIT_BYTES - NEWLINE_BYTES;

/** What a cut never takes a string below, so that every string that was cut still contains the mark saying so. */
const MIN_CUT_BYTES = Buffer.byteLength(TRUNCATION_MARK);

/** Marks the detail as a recording of an earlier run rather than as what this invocation produced. */
const REPLAY_MARKER = 'replayed:';

/** Returns the marker that a verdict leads with and the phrase that it reports, which only this module composes. */
function describeOutcome(verdict: Verdict, style: OutputStyle): { marker: string; phrase: string } {
  const statuses = STATUS_GLYPHS[style];

  switch (verdict.outcome) {
    case 'passed':
      return { marker: statuses.passed.text, phrase: `passed in ${formatDuration(verdict.durationMs)}` };
    case 'failed':
      return {
        marker: statuses.failed.text,
        phrase: `failed in ${formatDuration(verdict.durationMs)} (exit ${verdict.exitCode})`,
      };
    case 'recalled': {
      const saving = formatSaving(verdict.savedMs);
      const savingClause = saving === undefined ? '' : `, ${saving}`;
      return {
        marker: statuses.skipped.text,
        phrase: `passed ${formatDuration(verdict.ageMs)} ago on this tree${savingClause}`,
      };
    }
    case 'no-op':
      return { marker: NMR_GLYPHS[style].noop.text, phrase: `skipped, ${describeNoOpReason(verdict.reason)}` };
    default: {
      const unhandledVerdict: never = verdict;
      throw new Error(`Unhandled verdict outcome: ${JSON.stringify(unhandledVerdict)}`);
    }
  }
}

/** Returns the clause naming why a command ran nothing, which the `no-op` phrase ends with. */
function describeNoOpReason(reason: NoOpReason): string {
  switch (reason) {
    case 'empty-override':
      return 'the override is empty';
    case 'empty-workspace':
      return 'the workspace does not declare any package';
    case 'noop-override':
      return 'the override is a no-op';
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled no-op reason: ${String(unhandledReason)}`);
    }
  }
}

/**
 * Renders a recalled pass's replay for the detail slot, or `undefined` when there is nothing to replay.
 *
 * An excerpt that the verdict's own scope and command already name drops its attribution, which is the leaf whose
 * output the line is. Every other line keeps the attribution naming where it came from, so that a composite
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
 * Collapses a detail's line breaks into single spaces, so that one verdict stays one line.
 *
 * A detail is text taken from a command's output, which can contain line breaks.
 */
function flattenDetail(detail: string): string {
  return detail.replaceAll(/[\r\n]+/gu, ' ').trim();
}

/**
 * Returns the size to cut the longest of a set of strings down to, so that cutting each in turn brings the set
 * level rather than spending the whole overrun on the first string reached.
 *
 * The target is the next size that another string has; when every string is already that size, the target is this
 * string's share of the remaining overrun. A string at or below the mark is not a size to level toward -- counting
 * one, as the empty detail slot would be every time, puts the target at the mark and collapses the whole set on the
 * first pass.
 */
function findCutTarget(sizesBytes: readonly number[], longestSizeBytes: number, overrunBytes: number): number {
  const smallerSizesBytes = sizesBytes.filter((size) => size < longestSizeBytes && size > MIN_CUT_BYTES);
  const share = Math.ceil(overrunBytes / sizesBytes.filter((size) => size === longestSizeBytes).length);
  const target =
    smallerSizesBytes.length === 0
      ? longestSizeBytes - share
      : Math.max(...smallerSizesBytes, longestSizeBytes - overrunBytes);

  return Math.max(MIN_CUT_BYTES, target);
}

/** Reports whether a rendered line, once the newline is counted, is within the ceiling. */
function isWithinBudget(renderedLine: string): boolean {
  return Buffer.byteLength(renderedLine) <= LINE_BUDGET_BYTES;
}

/** Returns what each constituent of a replay is, without the excerpt that it contained. */
function readAttribution(verdict: Verdict): { command: string; scope: string }[] {
  if (verdict.outcome !== 'recalled' || verdict.replay === undefined) {
    return [];
  }

  return verdict.replay.map((line) => ({ command: line.command, scope: line.scope }));
}

/**
 * Returns the strings from which a cut can take, in the order an index addresses them: the detail slot, and then
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
  const clampedRecord = { ...record };
  let renderedLine = JSON.stringify(clampedRecord);

  while (!isWithinBudget(renderedLine)) {
    const fields = ['command', 'scope'];
    const sizesBytes = fields.map((field) =>
      Buffer.byteLength(typeof clampedRecord[field] === 'string' ? clampedRecord[field] : ''),
    );
    const longestSizeBytes = Math.max(...sizesBytes);
    if (longestSizeBytes <= MIN_CUT_BYTES) {
      return renderedLine;
    }

    const target = findCutTarget(sizesBytes, longestSizeBytes, Buffer.byteLength(renderedLine) - LINE_BUDGET_BYTES);
    const field = fields[sizesBytes.indexOf(longestSizeBytes)] ?? 'command';
    clampedRecord[field] = clampToBytes(typeof clampedRecord[field] === 'string' ? clampedRecord[field] : '', target);
    renderedLine = JSON.stringify(clampedRecord);
  }

  return renderedLine;
}

/**
 * Fits a record that overran the ceiling, by rungs.
 *
 * Each rung sheds what a reader can better spare than the rung below it: The excerpts are shortened toward one
 * another until they fit or every one is at the mark; then they are removed, leaving the scope and command that
 * name each constituent; then the constituents themselves are removed from the end, as the prose line drops its
 * own tail; and last the scope and the command are cut, because a line that overruns can be split across a pipe
 * and corrupt the records of every scope sharing it, whereas a marked cut damages only its own record.
 */
function renderWithinBudget(verdict: Verdict): string {
  const shortenedVerdict = shortenCuttableText(verdict);
  const shortenedLine = JSON.stringify(shortenedVerdict);
  if (isWithinBudget(shortenedLine)) {
    return shortenedLine;
  }

  const record: Record<string, unknown> = { ...shortenedVerdict };
  delete record['detail'];

  const attribution = readAttribution(shortenedVerdict);
  for (let keptCount = attribution.length; keptCount > 0; keptCount--) {
    record['replay'] = attribution.slice(0, keptCount);
    const renderedLine = JSON.stringify(record);
    if (isWithinBudget(renderedLine)) {
      return renderedLine;
    }
  }

  delete record['replay'];
  const bareLine = JSON.stringify(record);

  return isWithinBudget(bareLine) ? bareLine : renderClamped(record);
}

/**
 * Shortens the record's cuttable strings toward one another until they fit or every one is at the mark.
 *
 * Cutting the longest down toward the next-longest spreads the overrun over the whole assembly rather than
 * spending it on whichever constituent happens to be listed first, and the floor at the mark leaves every cut
 * string distinguishable from one that recorded nothing.
 */
function shortenCuttableText(verdict: Verdict): Verdict {
  let candidate = verdict;
  let renderedLine = JSON.stringify(candidate);

  while (!isWithinBudget(renderedLine)) {
    const shortenedVerdict = shortenLongestText(candidate, Buffer.byteLength(renderedLine) - LINE_BUDGET_BYTES);
    if (shortenedVerdict === undefined) {
      return candidate;
    }
    candidate = shortenedVerdict;
    renderedLine = JSON.stringify(candidate);
  }

  return candidate;
}

/**
 * Returns the verdict with its longest cuttable string cut toward the next-longest, or `undefined` when every
 * one of them is already at the mark and there is nothing left to give.
 *
 * The cut is always a strict shortening, bounded below by the mark, which makes the loop calling this terminate.
 */
function shortenLongestText(verdict: Verdict, overrunBytes: number): Verdict | undefined {
  const texts = readCuttableText(verdict);
  const sizesBytes = texts.map((text) => Buffer.byteLength(text));
  const longestSizeBytes = Math.max(...sizesBytes);
  if (longestSizeBytes <= MIN_CUT_BYTES) {
    return undefined;
  }

  const index = sizesBytes.indexOf(longestSizeBytes);
  const target = findCutTarget(sizesBytes, longestSizeBytes, overrunBytes);

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
