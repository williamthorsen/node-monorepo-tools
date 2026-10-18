import { Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { quoteForShell } from './helpers/quoteForShell.ts';
import { isObject } from './helpers/type-guards.ts';
import {
  type DelegationHolder,
  type HostSessionParams,
  runHostSession,
  type SessionRecord,
} from './remote-host-session.ts';

/** Reads a host session's stderr: its records until the run starts, and the run's own output after that. */
export interface SessionDemultiplexer {
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
 * arrives.
 */
export function createSessionDemultiplexer(options: {
  marker: string;
  onRecord: (record: SessionRecord) => void;
  stderr: Writable;
}): SessionDemultiplexer {
  const { marker, onRecord, stderr } = options;
  const decoder = new StringDecoder('utf8');
  const prefix = `${marker} `;
  let pending = '';
  let output = '';
  let hasStarted = false;

  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (hasStarted) {
        stderr.write(chunk);
        callback();
        return;
      }

      pending += decoder.write(chunk);
      let newlineIndex = pending.indexOf('\n');
      while (!hasStarted && newlineIndex !== -1) {
        const line = pending.slice(0, newlineIndex);
        pending = pending.slice(newlineIndex + 1);
        const record = line.startsWith(prefix) ? parseRecord(line.slice(prefix.length)) : undefined;
        if (record === undefined) {
          output += `${line}\n`;
        } else {
          onRecord(record);
          hasStarted = record.kind === 'run';
        }
        newlineIndex = pending.indexOf('\n');
      }

      if (hasStarted && pending !== '') {
        stderr.write(pending);
        pending = '';
      }
      callback();
    },
  });

  return {
    hasStarted: () => hasStarted,
    readOutput: () => (hasStarted ? output : output + pending + decoder.end()),
    stream,
  };
}

/** Renders the line that a delegation prints when it starts waiting for another delegation's checkout. */
export function formatDelegationWaitingLine(holder: DelegationHolder | undefined, host: string): string {
  if (holder === undefined) {
    return `nmr: waiting for another delegation's checkout on ${host}`;
  }

  return `nmr: waiting for ${holder.command} in ${holder.dir} (pid ${holder.pid}) to finish on ${host}`;
}

// region | Helpers

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
