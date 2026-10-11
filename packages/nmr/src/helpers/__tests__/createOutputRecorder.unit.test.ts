import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createOutputRecorder } from '../createOutputRecorder.ts';

describe(createOutputRecorder, () => {
  it('replays each chunk to its own stream, in the order in which the chunks arrived', async () => {
    const recorder = createOutputRecorder();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const merged: string[] = [];
    stdout.on('data', (chunk: Buffer) => {
      merged.push(`out:${chunk.toString('utf8')}`);
    });
    stderr.on('data', (chunk: Buffer) => {
      merged.push(`err:${chunk.toString('utf8')}`);
    });

    await write(recorder.stdout, 'a');
    await write(recorder.stderr, 'b');
    await write(recorder.stdout, 'c');
    recorder.replay({ stderr, stdout });

    expect(merged).toStrictEqual(['out:a', 'err:b', 'out:c']);
  });

  it('exposes destinations without a descriptor, so that a child writing to them is given a pipe', () => {
    const recorder = createOutputRecorder();

    expect('fd' in recorder.stdout).toBe(false);
    expect('fd' in recorder.stderr).toBe(false);
  });
});

// region | Helpers

/** Writes a string and resolves once the destination has accepted it. */
function write(destination: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    destination.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

// endregion | Helpers
