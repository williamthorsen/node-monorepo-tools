import { describe, expect, it } from 'vitest';

import { formatDuration, formatSaving } from '../duration.ts';

describe(formatDuration, () => {
  it.each([
    [0, '0s'],
    [1_000, '1s'],
    [59_000, '59s'],
  ])('renders %ims in seconds as %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  it.each([
    [60_000, '1m'],
    [240_000, '4m'],
    [3_540_000, '59m'],
  ])('renders %ims in minutes as %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  it.each([
    [3_600_000, '1h'],
    [7_200_000, '2h'],
  ])('renders %ims in hours as %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });
});

describe(formatSaving, () => {
  it('marks a saving with the speed-boost icon', () => {
    expect(formatSaving(240_000)).toBe('🚀 saved ~4m');
  });

  it('marks the smallest saving it will name', () => {
    // The threshold is where the icon starts appearing, so it is the boundary a reader notices.
    expect(formatSaving(1_000)).toBe('🚀 saved ~1s');
  });

  it.each([0, 1, 500, 999])('names no saving for %ims, which is under a second', (milliseconds) => {
    expect(formatSaving(milliseconds)).toBeUndefined();
  });

  it('names no saving for a negative duration', () => {
    expect(formatSaving(-1_000)).toBeUndefined();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('names no saving for the non-finite %d', (milliseconds) => {
    // A non-finite duration compares false against the threshold, so without its own guard the marker would
    // reach a reader as `saved ~NaNs`. The check cache rejects one before it is recorded; a later caller of
    // this shared function has no such validator standing in front of it.
    expect(formatSaving(milliseconds)).toBeUndefined();
  });
});
