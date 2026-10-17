import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { vi } from 'vitest';

export interface FakeChild extends EventEmitter {
  stdout: PassThrough | null;
  stderr: PassThrough | null;
}

/** Collects everything written to a stream, for comparison against what the child produced. */
export function collect(stream: PassThrough): () => Buffer {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  return () => Buffer.concat(chunks);
}

/** Builds a stream that has a descriptor without being a terminal, which is a redirected stdout. */
export function createRedirectedStream(): PassThrough & { fd: number } {
  return Object.assign(new PassThrough(), { fd: 1 });
}

/** Builds a stream that reports itself as a terminal, so the runner hands its descriptor to the child. */
export function createTerminalStream(): PassThrough & { fd: number; isTTY: boolean } {
  return Object.assign(new PassThrough(), { fd: 1, isTTY: true });
}

/** Ends the child's pipes, lets them flush, then emits the exit and close events that Node would emit. */
export async function endChild(
  child: FakeChild,
  code: number | null = 0,
  signal: NodeJS.Signals | null = null,
): Promise<void> {
  const flushes: Promise<void>[] = [];
  for (const stream of [child.stdout, child.stderr]) {
    if (stream === null) continue;
    flushes.push(new Promise<void>((resolve) => stream.on('end', () => resolve())));
    stream.end();
  }
  await Promise.all(flushes);
  child.emit('exit', code, signal);
  child.emit('close');
}

/** Yields to the event loop so that piped chunks reach their destination. */
export function flushEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Reads the stdio array that the runner passed to spawn. */
export function readStdioFromCall(): unknown[] {
  const options = vi.mocked(spawn).mock.calls[0]?.[2];
  if (!options || !Array.isArray(options.stdio)) throw new Error('Expected stdio to be an array');
  return options.stdio;
}
