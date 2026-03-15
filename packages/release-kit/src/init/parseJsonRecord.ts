import { isRecord } from '../typeGuards.ts';

/**
 * Parse a JSON string and return the result if it is a plain object (Record<string, unknown>).
 * Returns `undefined` if parsing fails or the result is not a plain object.
 */
export function parseJsonRecord(raw: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return isRecord(parsed) ? parsed : undefined;
}
