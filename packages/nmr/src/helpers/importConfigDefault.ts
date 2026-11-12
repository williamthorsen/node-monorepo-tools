import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { isRecord, UserError } from '@williamthorsen/nmr-core';
import { describeError, isError } from '@williamthorsen/toolbelt.errors';

/**
 * Imports the nmr config file at `configPath` and returns its default export, or `undefined` when the module does not
 * have one. Throws a `UserError` that names the file when it fails to parse or throws while loading, keeping the
 * original error as its `cause`. A parse error's location, when Node reports one, follows the config's path, or
 * precedes the cause's message when it lies in a module that the config imports.
 */
export async function importConfigDefault(configPath: string): Promise<unknown> {
  let importedModule: unknown;
  try {
    // Node type-strips `.ts` natively at this package's engines floor, so the config does not need a transform
    // step or a loader dependency. `import()` takes a URL, not a path: A bare Windows path parses as a scheme.
    importedModule = await import(pathToFileURL(configPath).href);
  } catch (error) {
    const location = readSyntaxErrorLocation(error);
    const isInConfig = location !== undefined && isConfigFile(location.file, configPath);
    const configLocation = isInConfig ? `${configPath}:${location.line}` : configPath;
    const foreignLocation = location === undefined || isInConfig ? '' : `${location.file}:${location.line}: `;
    throw new UserError(
      `Cannot load nmr config at ${configLocation}: ${foreignLocation}${describeError(error)}. Fix the file and rerun.`,
      { cause: error },
    );
  }

  return isRecord(importedModule) ? importedModule['default'] : undefined;
}

// region | Helpers

/**
 * Reports whether `file` is the config at `configPath`. Node names a module by its real path, so a config reached
 * through a symlinked directory matches by that path.
 */
function isConfigFile(file: string, configPath: string): boolean {
  return file === configPath || file === resolveRealPath(configPath);
}

/** Returns the file and line that a syntax error's stack header names as `<path>:<line>`, when it names one. */
function readSyntaxErrorLocation(error: unknown): { file: string; line: string } | undefined {
  if (!isError(error) || error.stack === undefined) {
    return undefined;
  }

  const match = /^(?<file>.+):(?<line>\d+)$/u.exec(error.stack.split('\n', 1)[0] ?? '');
  const { file, line } = match?.groups ?? {};
  return file === undefined || line === undefined ? undefined : { file, line };
}

/** Returns the real path of `filePath`, or `undefined` when it cannot be resolved. */
function resolveRealPath(filePath: string): string | undefined {
  try {
    return realpathSync(filePath);
  } catch {
    return undefined;
  }
}

// endregion | Helpers
