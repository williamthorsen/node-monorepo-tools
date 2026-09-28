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
  ])('renders %ims in seconds as %s', (milliseconds, expectedText) => {
    expect(formatDuration(milliseconds)).toBe(expectedText);
  });

  it.each([
    [60_000, '1m'],
    [90_000, '1m 30s'],
    [240_000, '4m'],
    [3_599_999, '59m 59s'],
  ])('renders %ims in minutes as %s', (milliseconds, expectedText) => {
    expect(formatDuration(milliseconds)).toBe(expectedText);
  });

  it.each([
    [3_600_000, '1h'],
    [7_200_000, '2h'],
    [7_500_000, '2h 5m'],
  ])('renders %ims in hours as %s', (milliseconds, expectedText) => {
    expect(formatDuration(milliseconds)).toBe(expectedText);
  });

  it.each([
    [89_999, '1m 29s'],
    [119_999, '1m 59s'],
  ])('truncates %ims to %s rather than rounding up to the next unit', (milliseconds, expectedText) => {
    expect(formatDuration(milliseconds)).toBe(expectedText);
  });
});

describe(formatSaving, () => {
  it('names the saving without terminal punctuation, so the caller supplies the grammar around it', () => {
    expect(formatSaving(240_000)).toBe('saved ~4m');
  });

  it('names the smallest saving that it will report', () => {
    // The clause starts appearing at the threshold, so it is the boundary that a reader notices.
    expect(formatSaving(1_000)).toBe('saved ~1s');
  });

  it.each([0, 1, 500, 999])('does not name a saving for %ims, which is under a second', (milliseconds) => {
    expect(formatSaving(milliseconds)).toBeUndefined();
  });

  it('does not name a saving for a negative duration', () => {
    expect(formatSaving(-1_000)).toBeUndefined();
  });

  it.each([NaN, Infinity])('does not name a saving for the non-finite %d', (milliseconds) => {
    expect(formatSaving(milliseconds)).toBeUndefined();
  });
});
