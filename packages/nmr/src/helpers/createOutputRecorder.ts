import { Writable } from 'node:stream';

/** Which of a child's output streams a recorded chunk arrived on. */
type StreamName = 'stderr' | 'stdout';

export interface OutputRecorder {
  /** Destination for the child's stderr. It does not have a descriptor, so a child writing to it is given a pipe. */
  stderr: Writable;
  /** Destination for the child's stdout. It does not have a descriptor, so a child writing to it is given a pipe. */
  stdout: Writable;
  /** Writes every recorded chunk to the destination matching its stream, in the order in which the chunks arrived. */
  replay: (destinations: Record<StreamName, Writable>) => void;
}

/**
 * Creates a pair of in-memory destinations that hold everything written to them, unbounded, so that output
 * produced while other output is streaming can be printed whole afterwards.
 */
export function createOutputRecorder(): OutputRecorder {
  const entries: Array<{ chunk: Buffer; stream: StreamName }> = [];

  /** Creates a destination that records each chunk under one stream name. */
  function createSink(stream: StreamName): Writable {
    return new Writable({
      write(chunk: unknown, encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding);
        entries.push({ chunk: buffer, stream });
        callback();
      },
    });
  }

  return {
    stderr: createSink('stderr'),
    stdout: createSink('stdout'),
    replay: (destinations) => {
      for (const { chunk, stream } of entries) {
        destinations[stream].write(chunk);
      }
    },
  };
}
