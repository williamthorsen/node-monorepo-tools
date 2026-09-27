import { isRecord } from '../typeGuards.ts';

/** Parses a JSON string, returning the result if it is a plain object and `undefined` otherwise. */
export function parseJsonRecord(raw: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return isRecord(parsed) ? parsed : undefined;
}
