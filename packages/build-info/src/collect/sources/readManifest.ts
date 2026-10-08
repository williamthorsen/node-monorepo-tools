import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The fields of a `package.json` that identify a build. */
export interface Manifest {
  name: string;
  version: string;
  /** The manifest's `repository` value as written: a string, an object with a `url`, or absent. */
  repository?: unknown;
}

/** Reads the name, version, and repository of the `package.json` in `cwd`, throwing when name or version is missing. */
export function readManifest(cwd: string): Manifest {
  const manifestPath = path.join(cwd, 'package.json');
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!isRecord(parsed)) {
    throw new TypeError(`${manifestPath} does not contain a JSON object`);
  }

  const { name, repository, version } = parsed;
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError(`${manifestPath} does not declare a name`);
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new TypeError(`${manifestPath} does not declare a version`);
  }

  return { name, version, ...(repository !== undefined && { repository }) };
}

// region | Helpers

/** Reports whether a value is a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// endregion | Helpers
