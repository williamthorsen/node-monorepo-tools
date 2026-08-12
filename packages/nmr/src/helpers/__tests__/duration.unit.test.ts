import { describe, expect, it } from 'vitest';

import { formatDuration, formatSaving } from '../duration.ts';

describe(formatDuration, () => {
  it.each([
    [0, '0s'],
    [300, '0.3s'],
    [1_000, '1s'],
    [12_000, '12s'],
    [12_449, '12.4s'],
    [59_999, '59.9s'],
  ])('renders %ims in seconds as %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  it.each([
    [60_000, '1m'],
    [90_000, '1m 30s'],
    [240_000, '4m'],
    [3_599_999, '59m 59s'],
  ])('renders %ims in minutes as %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  it.each([
    [3_600_000, '1h'],
    [7_200_000, '2h'],
    [7_500_000, '2h 5m'],
  ])('renders %ims in hours as %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  it.each([
    [89_999, '1m 29s'],
    [119_999, '1m 59s'],
  ])('truncates %ims to %s rather than rounding up to the next unit', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });
});

describe(formatSaving, () => {
  it('names the saving without terminal punctuation, so the caller supplies the grammar around it', () => {
    expect(formatSaving(240_000)).toBe('saved ~4m');
  });

  it('names the smallest saving it will report', () => {
    // The threshold is where the clause starts appearing, so it is the boundary a reader notices.
    expect(formatSaving(1_000)).toBe('saved ~1s');
  });

  it.each([0, 1, 500, 999])('names no saving for %ims, which is under a second', (milliseconds) => {
    expect(formatSaving(milliseconds)).toBeUndefined();
  });

  it('names no saving for a negative duration', () => {
    expect(formatSaving(-1_000)).toBeUndefined();
  });

  it.each([NaN, Infinity])('names no saving for the non-finite %d', (milliseconds) => {
    // A non-finite duration compares false against the threshold, so without its own guard the clause would
    // reach a reader as `saved ~NaNs`. The check cache rejects one before it is recorded; a later caller of
    // this shared function has no such validator standing in front of it.
    expect(formatSaving(milliseconds)).toBeUndefined();
  });
});
