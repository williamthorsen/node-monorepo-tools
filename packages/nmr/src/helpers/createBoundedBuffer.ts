import { formatElisionMarker } from './transcript.ts';

/** Bound applied to each end of the retained copy, so a run that overruns still yields both. */
const DEFAULT_HEAD_LIMIT_BYTES = 1_048_576;
const DEFAULT_TAIL_LIMIT_BYTES = 1_048_576;

export interface BoundedBufferOptions {
  headLimitBytes?: number;
  tailLimitBytes?: number;
}

export interface BoundedBuffer {
  /** Retains a chunk, dropping bytes from the middle once both ends are full. */
  append: (chunk: Buffer) => void;
  /** Renders the retained bytes, with a marker naming the dropped count standing in for what was dropped. */
  toBuffer: () => Buffer;
}

/**
 * Creates an accumulator that retains the first and last bytes it is fed and drops the middle.
 * Both ends are kept because a failing command's first error and its trailing summary each carry signal
 * that the other end does not.
 */
export function createBoundedBuffer(options: BoundedBufferOptions = {}): BoundedBuffer {
  const headLimitBytes = options.headLimitBytes ?? DEFAULT_HEAD_LIMIT_BYTES;
  const tailLimitBytes = options.tailLimitBytes ?? DEFAULT_TAIL_LIMIT_BYTES;

  const headChunks: Buffer[] = [];
  let headBytes = 0;

  // Allocated on the first byte past the head, so a run that stays under the bound never pays for it.
  let tailRing: Buffer | undefined;
  let tailOffset = 0;
  let tailBytes = 0;
  let elidedBytes = 0;

  function append(chunk: Buffer): void {
    let remainder = chunk;

    if (headBytes < headLimitBytes) {
      const takenBytes = Math.min(headLimitBytes - headBytes, remainder.length);
      headChunks.push(remainder.subarray(0, takenBytes));
      headBytes += takenBytes;
      remainder = remainder.subarray(takenBytes);
    }

    if (remainder.length > 0) {
      appendToTail(remainder);
    }
  }

  function appendToTail(chunk: Buffer): void {
    const ring = (tailRing ??= Buffer.alloc(tailLimitBytes));

    // A chunk at least as wide as the ring overwrites everything in it, so wraparound arithmetic does not apply.
    if (chunk.length >= tailLimitBytes) {
      elidedBytes += tailBytes + chunk.length - tailLimitBytes;
      chunk.copy(ring, 0, chunk.length - tailLimitBytes);
      tailOffset = 0;
      tailBytes = tailLimitBytes;
      return;
    }

    elidedBytes += Math.max(0, tailBytes + chunk.length - tailLimitBytes);
    const untilWrapBytes = Math.min(chunk.length, tailLimitBytes - tailOffset);
    chunk.copy(ring, tailOffset, 0, untilWrapBytes);
    if (untilWrapBytes < chunk.length) {
      chunk.copy(ring, 0, untilWrapBytes);
    }
    tailOffset = (tailOffset + chunk.length) % tailLimitBytes;
    tailBytes = Math.min(tailLimitBytes, tailBytes + chunk.length);
  }

  function toBuffer(): Buffer {
    const headBuffer = Buffer.concat(headChunks);
    if (tailRing === undefined) {
      return headBuffer;
    }

    const tailBuffer =
      tailBytes < tailLimitBytes
        ? tailRing.subarray(0, tailBytes)
        : Buffer.concat([tailRing.subarray(tailOffset), tailRing.subarray(0, tailOffset)]);

    if (elidedBytes === 0) {
      return Buffer.concat([headBuffer, tailBuffer]);
    }
    return Buffer.concat([headBuffer, Buffer.from(formatElisionMarker(elidedBytes)), tailBuffer]);
  }

  return { append, toBuffer };
}
