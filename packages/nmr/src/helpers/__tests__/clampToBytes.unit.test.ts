import { describe, expect, it } from 'vitest';

import { clampToBytes, TRUNCATION_MARK } from '../clampToBytes.ts';

describe(clampToBytes, () => {
  it('leaves a value already within the budget untouched, marking nothing', () => {
    expect(clampToBytes('passed in 12.4s', 512)).toBe('passed in 12.4s');
  });

  it('leaves a value sitting exactly on the budget untouched', () => {
    expect(clampToBytes('x'.repeat(64), 64)).toBe('x'.repeat(64));
  });

  it('cuts a value that would overrun the budget, marking the cut', () => {
    const clamped = clampToBytes('x'.repeat(600), 64);

    expect(Buffer.byteLength(clamped)).toBeLessThanOrEqual(64);
    expect(clamped.endsWith(TRUNCATION_MARK)).toBe(true);
  });

  it('counts bytes rather than characters, so a multi-byte value is cut sooner', () => {
    const clamped = clampToBytes('é'.repeat(100), 40);

    expect(Buffer.byteLength(clamped)).toBeLessThanOrEqual(40);
    expect(clamped.length).toBeLessThan(40);
  });

  it('cuts between code points, so a multi-byte character is never left in halves', () => {
    const clamped = clampToBytes('⏭'.repeat(100), 50);

    expect(clamped).toBe(Buffer.from(clamped).toString('utf8'));
    expect(Buffer.byteLength(clamped)).toBeLessThanOrEqual(50);
  });

  it('yields nothing at a budget too small to hold the mark, rather than overrunning it', () => {
    expect(clampToBytes('anything', 2)).toBe('');
  });

  it('yields the mark alone at a budget that holds it and nothing more', () => {
    expect(clampToBytes('anything', Buffer.byteLength(TRUNCATION_MARK))).toBe(TRUNCATION_MARK);
  });
});
