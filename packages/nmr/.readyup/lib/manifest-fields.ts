import type { CheckOutcome } from 'readyup';
import { isRecord } from 'readyup/check-utils';

import { findFiles, formatPaths, readFileIn } from './repo-files.ts';

/**
 * Checks that the `package.json` files in the tree do not declare a `pnpm` field.
 *
 * pnpm 11 does not read any key from that field, so every setting left in one is inert while still reading as
 * maintained. Because taze keeps its own list of dependency fields, an upgrade run with `--write` goes on
 * rewriting the versions in `pnpm.overrides`, which makes a dead block look current.
 *
 * The whole tree rather than the workspace globs: The field is dead in every manifest, whether or not pnpm
 * loads that one.
 *
 * @internal - Exported only to enable testing
 */
export function noPnpmFieldInPackageJson(cwd: string = process.cwd()): boolean | CheckOutcome {
  const declaringFiles = findFiles(['**/package.json'], cwd).flatMap((relativePath) => {
    const keys = readPnpmFieldKeys(readFileIn(cwd, relativePath));
    if (keys === undefined) return [];
    return keys.length > 0 ? `${relativePath} (${keys.join(', ')})` : relativePath;
  });

  if (declaringFiles.length === 0) return true;
  return { ok: false, detail: formatPaths(declaringFiles) };
}

/**
 * Checks that no `package.json` in the tree declares a `workspaces` field, which pnpm ignores in favor of
 * `pnpm-workspace.yaml`.
 *
 * @internal - Exported only to enable testing
 */
export function noWorkspacesFieldInPackageJson(cwd: string = process.cwd()): boolean | CheckOutcome {
  const declaringFiles = findFiles(['**/package.json'], cwd).filter((relativePath) =>
    declaresWorkspacesField(readFileIn(cwd, relativePath)),
  );

  if (declaringFiles.length === 0) return true;
  return { ok: false, detail: formatPaths(declaringFiles) };
}

// region | Helpers

/**
 * Reports whether a manifest declares a `workspaces` field. A manifest that does not parse reads as declaring none:
 * This check does not own the file.
 */
function declaresWorkspacesField(content: string | undefined): boolean {
  if (content === undefined) return false;

  try {
    const parsedManifest: unknown = JSON.parse(content);
    return isRecord(parsedManifest) && 'workspaces' in parsedManifest;
  } catch {
    return false;
  }
}

/**
 * Returns the keys in a manifest's `pnpm` field, sorted, or undefined when it does not declare that field.
 *
 * A manifest that does not parse reads as declaring none: This check does not own the file, and throwing over it
 * would abort the rest of the checklist.
 */
function readPnpmFieldKeys(content: string | undefined): string[] | undefined {
  if (content === undefined) return undefined;

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(content);
  } catch {
    return undefined;
  }

  if (!isRecord(parsedManifest)) return undefined;
  const pnpm = parsedManifest['pnpm'];

  return isRecord(pnpm) ? Object.keys(pnpm).toSorted() : undefined;
}

// endregion | Helpers
