import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

import { isRecord } from './typeGuards.ts';

/** Path of the root `package.json` consulted when validating a `project` block. */
export const ROOT_PACKAGE_JSON_PATH = 'package.json';

/**
 * Reads the root `package.json` and returns its `version` field.
 *
 * Returns `{ doesExist: false }` when the file is missing, `{ doesExist: true, version: undefined }`
 * when the file exists but does not have a `version` field, and `{ doesExist: true, version }`
 * when both are present; `mergeMonorepoConfig` decides whether the situation is an error.
 * Throws when the file cannot be read or parsed.
 */
export function readRootPackageVersion(): { doesExist: boolean; version: string | undefined } {
  const absolutePath = path.resolve(process.cwd(), ROOT_PACKAGE_JSON_PATH);
  if (!existsSync(absolutePath)) {
    return { doesExist: false, version: undefined };
  }

  let contents: string;
  try {
    contents = readFileSync(absolutePath, 'utf8');
  } catch (error: unknown) {
    throw chainError(`Failed to read root ${ROOT_PACKAGE_JSON_PATH}`, error);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(contents);
  } catch (error: unknown) {
    throw chainError(`Failed to parse root ${ROOT_PACKAGE_JSON_PATH}`, error);
  }

  if (!isRecord(parsedJson)) {
    return { doesExist: true, version: undefined };
  }
  return { doesExist: true, version: typeof parsedJson['version'] === 'string' ? parsedJson['version'] : undefined };
}

/** The path where the consumer-facing config file is expected. */
export const CONFIG_FILE_PATH = '.config/release-kit.config.ts';

/**
 * Loads the config file, returning the raw config object.
 *
 * `configPath` is resolved against the working directory, which the CLI sets to the repo root, and defaults to
 * `CONFIG_FILE_PATH`. The CLI resolves a `--config` value to an absolute path before passing it. An absent default
 * path returns `undefined`, because a repo that does not declare a config is a supported state; an absent named path
 * throws, because the caller asked for that file by name. Also throws when the file exists but cannot be
 * imported, or exports neither a default nor a named `config`.
 */
export async function loadConfig(configPath?: string): Promise<unknown> {
  const absoluteConfigPath = path.resolve(process.cwd(), configPath ?? CONFIG_FILE_PATH);

  if (!existsSync(absoluteConfigPath)) {
    if (configPath === undefined) {
      return undefined;
    }
    throw new Error(`Config file not found: ${absoluteConfigPath}`);
  }

  // Node type-strips `.ts` natively across this package's engines range, so the config does not need a transform
  // step or a loader dependency. `import()` takes a URL, not a path: A bare Windows path parses as a scheme.
  const importedModule: unknown = await import(pathToFileURL(absoluteConfigPath).href);

  // `isRecord` narrows the namespace for property access. Because reading an undeclared export off it yields
  // `undefined`, the fallback does not need a membership check.
  const resolvedConfig = isRecord(importedModule) ? (importedModule['default'] ?? importedModule['config']) : undefined;
  if (resolvedConfig === undefined) {
    throw new Error(
      'Config file must have a default export or a named `config` export (e.g., `export default { ... }` or `export const config = { ... }`)',
    );
  }

  return resolvedConfig;
}
