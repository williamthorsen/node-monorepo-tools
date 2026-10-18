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
 * The run's output is forwarded as bytes, so that a character split across chunks arrives unchanged. Only trailing bytes
 * that may still begin a record are held back, until they turn out not to or the record's newline arrives.
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

  /**
   * Forwards the run's output, taking out each `passes` record wherever its marker begins, and holds back only the
   * trailing bytes that may still begin a record. The nonce makes a marker within a line as unforgeable as one at its
   * start, and the session's record can follow output that did not end its line.
   */
  function forwardRunOutput(): void {
    let segmentStart = 0;
    let searchFrom = 0;
    let markerIndex = pending.indexOf(prefixBytes, searchFrom);
    while (markerIndex !== -1) {
      const newlineIndex = pending.indexOf(NEWLINE, markerIndex);
      if (newlineIndex === -1) {
        writeRange(segmentStart, markerIndex);
        pending = pending.subarray(markerIndex);
        return;
      }
      const kind = readPassesRecord(pending.subarray(markerIndex + prefixBytes.length, newlineIndex).toString('utf8'));
      if (kind !== 'other') {
        writeRange(segmentStart, markerIndex);
        segmentStart = newlineIndex + 1;
      }
      searchFrom = newlineIndex + 1;
      markerIndex = pending.indexOf(prefixBytes, searchFrom);
    }

    const holdFrom = findPartialPrefix(searchFrom);
    writeRange(segmentStart, holdFrom);
    pending = pending.subarray(holdFrom);
  }

  /** Returns the earliest index from `from` at which the pending bytes that remain begin the prefix, or their end. */
  function findPartialPrefix(from: number): number {
    for (let index = Math.max(from, pending.length - prefixBytes.length + 1); index < pending.length; index++) {
      if (prefixBytes.subarray(0, pending.length - index).equals(pending.subarray(index))) {
        return index;
      }
    }
    return pending.length;
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
