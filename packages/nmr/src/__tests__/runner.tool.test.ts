import process from 'node:process';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { type OutputChannels, runCommand } from '../runner.ts';

const PRODUCED_BYTES = 2_000_000;

/** What a caller writing to a non-terminal destination resolves, which is the arrangement these model. */
const PIPED_CHANNELS: OutputChannels = { stderr: 'pipe', stdout: 'pipe' };

/** Collects everything written to a stream, for comparison against what the command produced. */
function collect(stream: PassThrough): () => Buffer {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  return () => Buffer.concat(chunks);
}

describe(runCommand, () => {
  it('when a command writes past the old 1 MiB capture ceiling, passes and forwards every byte', async () => {
    const destination = new PassThrough();
    const received = collect(destination);

    const result = await runCommand(
      `"${process.execPath}" -e "process.stdout.write('a'.repeat(${PRODUCED_BYTES}))"`,
      undefined,
      { channels: PIPED_CHANNELS, stderr: new PassThrough(), stdout: destination },
    );

    expect(result).toMatchObject({ exitCode: 0, outcome: 'exited' });
    expect(received()).toHaveLength(PRODUCED_BYTES);
    expect(result.stdout).toHaveLength(PRODUCED_BYTES);
  });

  it('when a descendant holds the output pipe open, resolves on the exit status without waiting for it', async () => {
    const destination = new PassThrough();
    const received = collect(destination);
    const startedAt = Date.now();

    // `sleep` inherits the pipe and outlives the shell, so the pipe never closes on its own.
    const result = await runCommand('sleep 20 & echo ready', undefined, {
      channels: PIPED_CHANNELS,
      stderr: new PassThrough(),
      stdout: destination,
    });

    expect(result).toMatchObject({ exitCode: 0, outcome: 'exited' });
    expect(received().toString('utf8')).toContain('ready');
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 30_000);
});
