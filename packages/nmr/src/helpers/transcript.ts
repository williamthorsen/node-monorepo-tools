import type { RetainedOutput } from '../runner.ts';

/**
 * The bound on what one recorded pass persists, and therefore on what `nmr --log` can print back.
 *
 * A quantity of its own, distinct from the two that bound the same bytes elsewhere: the in-memory copy kept by a
 * command's capture is bounded per stream, for a failure that this run may still have to report, and a verdict
 * line is bounded at the size of an atomic pipe write. This one bounds what a cache directory accumulates over
 * every scope and command recorded in a repo.
 */
export const TRANSCRIPT_LIMIT_BYTES = 262_144;

/**
 * Matches the escape sequences that a command writes when it colors output not sent to a terminal: a control
 * sequence, and an operating-system command such as the one in which a hyperlink is wrapped.
 *
 * The parameter, intermediate, and final byte ranges are ECMA-48's own, so the colon-separated form of a
 * 24-bit color is matched alongside the semicolon-separated one. Admitting only the commoner form would strip
 * a reset while leaving the setter that precedes it, and a replayed line would color the terminal permanently.
 */
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex -- an escape sequence is defined by the control characters composing it.
  /\u{1B}(?:\[[\u{30}-\u{3F}]*[\u{20}-\u{2F}]*[\u{40}-\u{7E}]|\][^\u{7}\u{1B}]*(?:\u{7}|\u{1B}\\))/gu;

/** What each end of an overrunning transcript keeps, the middle being replaced by the elision marker. */
const END_LIMIT_BYTES = TRANSCRIPT_LIMIT_BYTES / 2;

/** Names where a command's stderr begins, in nmr's voice so that it is not mistaken for the command's own. */
const STREAM_MARKER = '\n… nmr: stderr …\n';

/**
 * Reduces a command's raw output to the form that nmr persists: escape sequences dropped, and a line redrawn by
 * the command reduced to what a reader was left looking at.
 *
 * Applied where the bytes are stored rather than where they are captured. The copy that a quiet run writes to
 * stderr on failure is the command's own output going to a stream that may be a terminal, and stripping its
 * color there would be a loss.
 */
export function cleanTranscript(rawText: string): string {
  return rawText
    .replaceAll(ANSI_PATTERN, '')
    .split('\n')
    .map((line) => renderCarriageReturns(line))
    .join('\n');
}

/**
 * Composes what a pass persists from what its command wrote, or `undefined` when it wrote nothing worth
 * keeping.
 *
 * The streams follow one another rather than interleaving, in the order in which a quiet run already prints them
 * on failure: nmr reads each through a pipe of its own, so it does not know their true interleaving. An empty
 * stream contributes neither content nor marker.
 */
export function composeTranscript(retainedOutput: RetainedOutput): string | undefined {
  const streams = [retainedOutput.stdout, retainedOutput.stderr]
    .map((stream) => cleanTranscript(stream.toString('utf8')))
    .filter((stream) => stream.trim() !== '');
  if (streams.length === 0) {
    return undefined;
  }

  return clampTranscript(streams.join(STREAM_MARKER));
}

/** Renders the line that stands in for dropped bytes, in nmr's voice so that it is not mistaken for the tool's. */
export function formatElisionMarker(byteCount: number): string {
  const unit = byteCount === 1 ? 'byte' : 'bytes';
  return `\n… nmr elided ${byteCount.toLocaleString('en-US')} ${unit} …\n`;
}

// region | Helpers

/**
 * Moves an offset back off the head of a character that it falls inside, so that a cut never closes on half of one.
 */
function alignEnd(buffer: Buffer, endOffset: number): number {
  let alignedOffset = Math.min(buffer.length, endOffset);
  while (alignedOffset > 0 && isContinuationByte(buffer[alignedOffset])) {
    alignedOffset--;
  }

  return alignedOffset;
}

/**
 * Moves an offset forward off the tail of a character that it falls inside, so that a cut never opens on half of
 * one.
 */
function alignStart(buffer: Buffer, startOffset: number): number {
  let alignedOffset = Math.max(0, startOffset);
  while (alignedOffset < buffer.length && isContinuationByte(buffer[alignedOffset])) {
    alignedOffset++;
  }

  return alignedOffset;
}

/**
 * Cuts a transcript that would overrun the ceiling, keeping both ends and marking what fell between them.
 *
 * Keeps both ends because a run's opening and its closing statement each contain what the other does not.
 */
function clampTranscript(transcript: string): string {
  const buffer = Buffer.from(transcript, 'utf8');
  if (buffer.length <= TRANSCRIPT_LIMIT_BYTES) {
    return transcript;
  }

  const headEnd = alignEnd(buffer, END_LIMIT_BYTES);
  const tailStart = alignStart(buffer, buffer.length - END_LIMIT_BYTES);
  const head = buffer.subarray(0, headEnd).toString('utf8');
  const tail = buffer.subarray(tailStart).toString('utf8');

  return `${head}${formatElisionMarker(tailStart - headEnd)}${tail}`;
}

/** Reports whether a byte continues a multi-byte character rather than beginning one. */
function isContinuationByte(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0b1100_0000) === 0b1000_0000;
}

/**
 * Reduces a line redrawn by a tool to what a reader was left looking at: the last segment for which a carriage
 * return moved the cursor back. Every earlier segment was overwritten, and joining them would replay text that
 * no one saw.
 *
 * An empty segment leaves the one before it in place, so a line ending in a carriage return keeps its text
 * rather than reading as blank and splitting the block that it belongs to.
 */
function renderCarriageReturns(line: string): string {
  if (!line.includes('\r')) {
    return line;
  }

  const segments = line.split('\r').filter((segment) => segment.trim() !== '');

  return segments.at(-1) ?? '';
}

// endregion | Helpers
