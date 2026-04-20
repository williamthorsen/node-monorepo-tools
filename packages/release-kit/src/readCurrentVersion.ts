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
  } catch (error: unknown) {
    // Return undefined so benign callers degrade gracefully, but surface the failure so
    // operators get a signal when --set-version or similar paths depend on this value.
    console.warn(
      `Failed to read current version from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return undefined;
}
