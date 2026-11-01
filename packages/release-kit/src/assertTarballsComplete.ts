import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';

import { detectPackageManager } from './detectPackageManager.ts';
import { findMissingManifestPaths, type MissingManifestPath } from './findMissingManifestPaths.ts';
import { isPublishableManifest } from './isPublishableManifest.ts';
import { packFromCleanCheckout } from './packFromCleanCheckout.ts';
import { isRecord } from './typeGuards.ts';

/**
 * Throws when the tarball of a publishable package among the given workspaces would lack a file that its manifest
 * names, or when the packages cannot be packed from a clean checkout of HEAD.
 *
 * Each workspace path is repo-relative and is read from the current directory. A private package is not packed, and
 * an empty list doesn't clone anything.
 */
export function assertTarballsComplete(
  workspacePaths: readonly string[],
  devExportConditions: readonly string[],
  pack: typeof packFromCleanCheckout = packFromCleanCheckout,
): void {
  const candidates = workspacePaths
    .map((workspacePath) => ({ workspacePath, manifest: readManifest(workspacePath) }))
    .filter(({ manifest }) => isPublishableManifest(manifest));
  if (candidates.length === 0) {
    return;
  }

  process.stderr.write(
    `Checking the tarballs of ${candidates.length} ${candidates.length === 1 ? 'package' : 'packages'} from a clean checkout of HEAD...\n`,
  );

  let filesByWorkspace: Map<string, string[]>;
  try {
    filesByWorkspace = pack(
      candidates.map(({ workspacePath }) => workspacePath),
      detectPackageManager(),
    );
  } catch (error: unknown) {
    throw new Error(
      `Cannot release: The packages could not be packed from a clean checkout of HEAD.\n${describeError(error)}`,
      { cause: error },
    );
  }

  const incompletePackages = candidates
    .map(({ workspacePath, manifest }) => ({
      workspacePath,
      manifest,
      missingPaths: findMissingManifestPaths(manifest, filesByWorkspace.get(workspacePath) ?? [], devExportConditions),
    }))
    .filter(({ missingPaths }) => missingPaths.length > 0);
  if (incompletePackages.length === 0) {
    return;
  }

  throw new Error(describeRefusal(incompletePackages));
}

// region | Helpers

/** Composes the refusal message, listing each package with the paths that its tarball lacks. */
function describeRefusal(
  incompletePackages: ReadonlyArray<{
    workspacePath: string;
    manifest: Record<string, unknown>;
    missingPaths: readonly MissingManifestPath[];
  }>,
): string {
  const sections = ['Cannot release: The tarball of every package must contain each file that its manifest names.'];

  for (const { workspacePath, manifest, missingPaths } of incompletePackages) {
    const name = typeof manifest['name'] === 'string' ? manifest['name'] : workspacePath;
    sections.push(
      [
        `${name} (${workspacePath}) lacks:`,
        ...missingPaths.map(({ location, path }) => `  - ${path} (${location})`),
      ].join('\n'),
    );
  }

  sections.push(
    'Build these files in the package\'s publish lifecycle, such as in a "prepack" script. ' +
      'If an export condition is for development only, list it in the "devExportConditions" config key.',
  );
  return sections.join('\n\n');
}

/** Reads a workspace's `package.json`, returning an empty record when it is not an object. */
function readManifest(workspacePath: string): Record<string, unknown> {
  const manifest: unknown = JSON.parse(readFileSync(join(workspacePath, 'package.json'), 'utf8'));
  return isRecord(manifest) ? manifest : {};
}

// endregion | Helpers
