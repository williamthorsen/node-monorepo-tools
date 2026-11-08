import { isRecord } from '@williamthorsen/nmr-core';

/** Narrows an unknown value to a record of plain strings. */
export function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}
