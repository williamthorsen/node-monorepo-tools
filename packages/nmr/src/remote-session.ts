import { Writable } from 'node:stream';

import { quoteForShell } from './helpers/quoteForShell.ts';
import { isObject } from './helpers/type-guards.ts';
import {
  type DelegationHolder,
  type HostSessionParams,
  runHostSession,
  type SessionRecord,
} from './remote-host-session.ts';

/**
 * Reads a host session's stderr: its records until the run starts, then the run's own output, and the session's
 * report of the passes that the run recorded once it has ended.
 */
export interface SessionDemultiplexer {
  /** Forwards what the stream held back as the possible start of a record, once the session has ended. */
  flush: () => void;
  /** Whether the session reported that the run started. */
  hasStarted: () => boolean;
  /** Returns what the session printed before the run started, other than its records. */
  readOutput: () => string;
  stream: Writable;
}

/**
 * Composes the script that runs the host session from the checkout. `checkoutDir` is a shell expression, so that it
 * can name the host's home directory.
 */
export function composeSessionScript(options: { checkoutDir: string; params: HostSessionParams }): string {
  const { checkoutDir, params } = options;
  const source = `(${runHostSession.toString()})(JSON.parse(process.argv[1]));`;

  return `cd ${checkoutDir} && exec node -e ${quoteForShell(source)} ${quoteForShell(JSON.stringify(params))}`;
}

/**
 * Returns a demultiplexer that passes each of the session's records to `onRecord` until the `run` record, keeps the
 * other text that arrives before it as the session's output, and forwards everything after it to `stderr` as it
 * arrives, except a `passes` record, which it passes to `onRecord` too. A `passes` record whose entries are not a list
 * goes to `onMalformedRecord` instead.
 *
 * The run's output is forwarded as bytes, line by line, so that a character split across chunks arrives unchanged. Only
 * a trailing partial line that may still turn out to be a record is held back until its newline arrives.
 */
export function createSessionDemultiplexer(options: {
  marker: string;
  onMalformedRecord?: () => void;
  onRecord: (record: SessionRecord) => void;
  stderr: Writable;
}): SessionDemultiplexer {
  const { marker, onMalformedRecord, onRecord, stderr } = options;
  const prefix = `${marker} `;
  const prefixBytes = Buffer.from(prefix);
  let pending: Buffer = Buffer.alloc(0);
  let output = '';
  let hasStarted = false;

  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      readSessionLines();
      if (hasStarted) {
        forwardRunOutput();
      }
      callback();
    },
  });

  return {
    flush() {
      if (!hasStarted || pending.length === 0) {
        return;
      }
      stderr.write(pending);
      pending = Buffer.alloc(0);
    },
    hasStarted: () => hasStarted,
    readOutput: () => (hasStarted ? output : output + pending.toString('utf8')),
    stream,
  };

  /** Reads complete lines until the run starts, passing each record on and keeping other lines as output. */
  function readSessionLines(): void {
    let newlineIndex = pending.indexOf(NEWLINE);
    while (!hasStarted && newlineIndex !== -1) {
      const line = pending.subarray(0, newlineIndex).toString('utf8');
      pending = pending.subarray(newlineIndex + 1);
      const record = line.startsWith(prefix) ? parseRecord(line.slice(prefix.length)) : undefined;
      if (record === undefined) {
        output += `${line}\n`;
      } else {
        onRecord(record);
        hasStarted = record.kind === 'run';
      }
      newlineIndex = pending.indexOf(NEWLINE);
    }
  }

  /** Forwards the run's complete lines, taking out each `passes` record, and what of a partial line cannot be one. */
  function forwardRunOutput(): void {
    let segmentStart = 0;
    let lineStart = 0;
    let newlineIndex = pending.indexOf(NEWLINE);
    while (newlineIndex !== -1) {
      if (isPrefixAt(lineStart)) {
        const kind = readPassesRecord(pending.subarray(lineStart + prefixBytes.length, newlineIndex).toString('utf8'));
        if (kind !== 'other') {
          writeRange(segmentStart, lineStart);
          segmentStart = newlineIndex + 1;
        }
      }
      lineStart = newlineIndex + 1;
      newlineIndex = pending.indexOf(NEWLINE, lineStart);
    }

    const rest = pending.subarray(lineStart);
    const mayBeRecord =
      rest.length >= prefixBytes.length ? isPrefixAt(lineStart) : prefixBytes.subarray(0, rest.length).equals(rest);
    const end = rest.length > 0 && mayBeRecord ? lineStart : pending.length;
    writeRange(segmentStart, end);
    pending = pending.subarray(end);
  }

  /** Reports whether the pending bytes at `index` begin with the record prefix. */
  function isPrefixAt(index: number): boolean {
    return (
      pending.length - index >= prefixBytes.length &&
      pending.compare(prefixBytes, 0, prefixBytes.length, index, index + prefixBytes.length) === 0
    );
  }

  /**
   * Passes a `passes` record on and reports it, reports a malformed one, and reports any other line, which is output.
   */
  function readPassesRecord(json: string): 'malformed' | 'other' | 'passes' {
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      return 'other';
    }
    if (!isObject(value) || value['kind'] !== 'passes') {
      return 'other';
    }
    const entries = value['entries'];
    if (!Array.isArray(entries)) {
      onMalformedRecord?.();
      return 'malformed';
    }
    onRecord({ kind: 'passes', entries });
    return 'passes';
  }

  /** Writes a range of the pending bytes to `stderr`, unless it is empty. */
  function writeRange(start: number, end: number): void {
    if (end > start) {
      stderr.write(pending.subarray(start, end));
    }
  }
}

/** Renders the line that a delegation prints when it starts waiting for another delegation's checkout. */
export function formatDelegationWaitingLine(holder: DelegationHolder | undefined, host: string): string {
  if (holder === undefined) {
    return `nmr: waiting for another delegation's checkout on ${host}`;
  }

  return `nmr: waiting for ${holder.command} in ${holder.dir} (pid ${holder.pid}) to finish on ${host}`;
}

// region | Helpers

/** The byte that ends a line. */
const NEWLINE = 0x0a;

/** Narrows a record's holder. */
function isDelegationHolder(value: unknown): value is DelegationHolder {
  return (
    isObject(value) &&
    typeof value['command'] === 'string' &&
    typeof value['dir'] === 'string' &&
    typeof value['pid'] === 'number'
  );
}

/** Narrows a parsed line to a session record. */
function isSessionRecord(value: unknown): value is SessionRecord {
  if (!isObject(value)) return false;
  switch (value['kind']) {
    case 'failed':
      return (
        typeof value['exitCode'] === 'number' &&
        typeof value['output'] === 'string' &&
        (value['phase'] === 'check out' || value['phase'] === 'install')
      );
    case 'locked':
    case 'run':
      return true;
    case 'passes':
      return Array.isArray(value['entries']);
    case 'waiting':
      return value['holder'] === undefined || isDelegationHolder(value['holder']);
    default:
      return false;
  }
}

/** Parses a record's JSON, or returns `undefined` when it is not a session record. */
function parseRecord(json: string): SessionRecord | undefined {
  try {
    const value: unknown = JSON.parse(json);
    return isSessionRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

// endregion | Helpers
