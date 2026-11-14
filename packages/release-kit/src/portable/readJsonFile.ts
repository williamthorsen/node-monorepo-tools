import { readFileSync } from 'node:fs';

import { chainUserError } from './user-error-chaining.ts';

/** Reads a UTF-8 file and parses it as JSON, throwing a `UserError` that names the file when either step fails. */
export function readJsonFile(filePath: string): unknown {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    throw chainUserError(`Failed to read ${filePath}`, error);
  }

  try {
    return JSON.parse(content);
  } catch (error: unknown) {
    throw chainUserError(`Failed to parse JSON in ${filePath}`, error);
  }
}
