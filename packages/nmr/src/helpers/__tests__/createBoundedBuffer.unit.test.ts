import { describe, expect, it } from 'vitest';

import { type BoundedBufferOptions, createBoundedBuffer } from '../createBoundedBuffer.ts';

const SMALL_BOUND: BoundedBufferOptions = { headLimitBytes: 4, tailLimitBytes: 4 };

/** Feeds each chunk to a buffer built under the small bound and decodes what it retained. */
function retain(chunks: string[]): string {
  const buffer = createBoundedBuffer(SMALL_BOUND);
  for (const chunk of chunks) {
    buffer.append(Buffer.from(chunk));
  }
  return buffer.toBuffer().toString('utf8');
}

describe(createBoundedBuffer, () => {
  it('when nothing is appended, retains no bytes', () => {
    expect(retain([])).toBe('');
  });

  it.each([
    { chunks: ['abc'], expected: 'abc', scenario: 'under both bounds' },
    { chunks: ['abcdefgh'], expected: 'abcdefgh', scenario: 'exactly filling both bounds' },
    { chunks: ['ab', 'cd', 'ef'], expected: 'abcdef', scenario: 'split across several chunks' },
  ])(
    'when the total stays within the bounds ($scenario), retains every byte and adds no marker',
    ({ chunks, expected }) => {
      expect(retain(chunks)).toBe(expected);
    },
  );

  it('when one chunk straddles the head bound, splits it across head and tail', () => {
    expect(retain(['abc', 'defghij'])).toBe('abcd\n… nmr elided 2 bytes …\nghij');
  });

  it('when a chunk is wider than the whole bound, retains only its final bytes', () => {
    expect(retain(['abcdefghijklmnop'])).toBe('abcd\n… nmr elided 8 bytes …\nmnop');
  });

  it('when appends overflow the tail repeatedly, evicts oldest first and accumulates the dropped count', () => {
    expect(retain(['abcd', 'e', 'f', 'g', 'h', 'i', 'j'])).toBe('abcd\n… nmr elided 2 bytes …\nghij');
  });

  it('when a chunk straddles the end of the tail ring, wraps its remainder to the front', () => {
    expect(retain(['abcd', 'efg', 'hi'])).toBe('abcd\n… nmr elided 1 byte …\nfghi');
  });

  it('when exactly one byte is dropped, the marker reads in the singular', () => {
    expect(retain(['abcd', 'e', 'f', 'g', 'h', 'i'])).toBe('abcd\n… nmr elided 1 byte …\nfghi');
  });

  it('when a multi-byte character spans two chunks, decodes it intact', () => {
    const encoded = Buffer.from('€');
    const buffer = createBoundedBuffer();

    buffer.append(encoded.subarray(0, 2));
    buffer.append(encoded.subarray(2));

    expect(buffer.toBuffer().toString('utf8')).toBe('€');
  });
});
