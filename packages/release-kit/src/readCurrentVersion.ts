import { readFileSync } from 'node:fs';

/** Type guard asserting that `value` is an object with a string `version` field. */
function hasVersionField(value: unknown): value is { version: string } {
  return typeof value === 'object' && value !== null && 'version' in value && typeof value.version === 'string';
}

/** Read the `version` field from a package.json file. Returns undefined if the file can't be read or parsed. */
export function readCurrentVersion(filePath: string): string | undefined {
  try {
    const content = readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(content);
    if (hasVersionField(parsed)) {
      return parsed.version;
    }
  } catch {
    // Return undefined if the file can't be read or parsed.
  }
  return undefined;
}
