import { isRecord } from '../typeGuards.ts';

/** Parses a JSON string, returning the result if it is a plain object and `undefined` otherwise. */
export function parseJsonRecord(jsonText: string): Record<string, unknown> | undefined {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    return undefined;
  }
  return isRecord(parsedJson) ? parsedJson : undefined;
}
