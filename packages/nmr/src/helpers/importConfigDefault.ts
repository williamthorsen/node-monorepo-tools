import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { isRecord, UserError } from '@williamthorsen/nmr-core';
import { describeError, isError } from '@williamthorsen/toolbelt.errors';

/**
 * Imports the nmr config file at `configPath` and returns its default export, or `undefined` when the module does not
 * have one. Throws a `UserError` that names the file, and the line when Node reports one, when the file fails to parse
 * or throws while loading, keeping the original error as its `cause`.
 */
export async function importConfigDefault(configPath: string): Promise<unknown> {
  let importedModule: unknown;
  try {
    // Node type-strips `.ts` natively at this package's engines floor, so the config does not need a transform
    // step or a loader dependency. `import()` takes a URL, not a path: A bare Windows path parses as a scheme.
    importedModule = await import(pathToFileURL(configPath).href);
  } catch (error) {
    const line = readSyntaxErrorLine(error, configPath);
    const location = line === undefined ? configPath : `${configPath}:${line}`;
    throw new UserError(`Cannot load nmr config at ${location}: ${describeError(error)}. Fix the file and rerun.`, {
      cause: error,
    });
  }

  return isRecord(importedModule) ? importedModule['default'] : undefined;
}

// region | Helpers

/**
 * Returns the line that a syntax error's stack header names, as `<path>:<line>`, when the path is the config's own.
 * Node names the module by its real path, so a config reached through a symlinked directory matches by that path.
 */
function readSyntaxErrorLine(error: unknown, configPath: string): string | undefined {
  if (!isError(error) || error.stack === undefined) {
    return undefined;
  }

  const match = /^(?<file>.+):(?<line>\d+)$/u.exec(error.stack.split('\n', 1)[0] ?? '');
  const { file, line } = match?.groups ?? {};
  if (file === undefined || line === undefined) {
    return undefined;
  }

  return file === configPath || file === resolveRealPath(configPath) ? line : undefined;
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
