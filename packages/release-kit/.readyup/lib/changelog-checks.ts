import type { CheckOutcome } from 'readyup';
import { discoverWorkspaces, readFile } from 'readyup/check-utils';

import { CHANGELOG_ARCHIVE_DIRECTORY } from '../../src/changelogArchive.ts';
import { packsPath } from '../../src/packsPath.ts';

/**
 * Checks whether the config sets `changelogMarkdown.keepVersions`, which moves older `CHANGELOG.md` sections into
 * archive files. Reads the raw config text, so a value set by an expression counts as set.
 */
export function changelogArchivesAreEnabled(): boolean {
  const content = readFile('.config/release-kit.config.ts');
  if (content === undefined) return false;
  return /changelogMarkdown\s*:\s*\{[^}]*keepVersions\s*:/.test(content);
}

/**
 * Checks whether the repo leaves structured changelog generation on.
 *
 * A repo without a config file inherits the enabled default, so a missing config file passes.
 */
export function changelogJsonIsEnabled(): boolean {
  const content = readFile('.config/release-kit.config.ts');
  if (content === undefined) return true;
  return !/changelogJson\s*:\s*\{[^}]*enabled\s*:\s*false/.test(content);
}

/**
 * Where release-kit writes the structured changelog when the config does not name any other path.
 *
 * Mirrors `DEFAULT_CHANGELOG_JSON_CONFIG.outputPath`, which the kit does not import: Importing `src/defaults.ts`
 * would pull change-grammar's taxonomy and its dependencies into the bundle that this package publishes.
 * `src/__tests__/kit-changelog-packaging-checks.unit.test.ts` asserts the two stay equal.
 */
export const DEFAULT_CHANGELOG_JSON_PATH = '.meta/changelog.json';

/**
 * Checks that every publishable workspace would publish `CHANGELOG.md`.
 */
export function packagesShipChangelog(): boolean | CheckOutcome {
  return reportWorkspacesOmitting('CHANGELOG.md');
}

/**
 * Checks that every publishable workspace would publish the archive files of its `CHANGELOG.md`.
 */
export function packagesShipChangelogArchives(): boolean | CheckOutcome {
  return reportWorkspacesOmitting(`${CHANGELOG_ARCHIVE_DIRECTORY}/CHANGELOG-v1.md`, `${CHANGELOG_ARCHIVE_DIRECTORY}/`);
}

/**
 * Checks that every publishable workspace would publish the structured changelog.
 */
export function packagesShipChangelogJson(): boolean | CheckOutcome {
  return reportWorkspacesOmitting(resolveChangelogJsonOutputPath());
}

/**
 * Resolves the path to which release-kit writes the structured changelog.
 *
 * Reads the raw config text rather than importing the config, as the neighboring config checks do.
 */
export function resolveChangelogJsonOutputPath(): string {
  const content = readFile('.config/release-kit.config.ts');
  if (content === undefined) return DEFAULT_CHANGELOG_JSON_PATH;

  const match = /changelogJson\s*:\s*\{[^}]*outputPath\s*:\s*['"]([^'"]+)['"]/.exec(content);
  return match?.[1] ?? DEFAULT_CHANGELOG_JSON_PATH;
}

// region | Helpers

/**
 * Names the publishable workspaces whose `files` field would leave `path` out of the tarball, naming the omission as
 * `label`.
 *
 * Workspace discovery reports the repo root in both repo types, so a publishable root is checked like any other
 * package and a `private: true` workspace is filtered out before its `files` field is read. The check does not
 * require `path` to exist on disk: A repo adopting release-kit before its first release should widen `files`
 * then, not after the first changelog is generated.
 */
function reportWorkspacesOmitting(path: string, label = path): boolean | CheckOutcome {
  const failing: string[] = [];
  const packageWorkspaces = discoverWorkspaces({ filter: (w) => w.isPackage });
  for (const { dir, packageJson } of packageWorkspaces) {
    if (!packsPath(packageJson['files'], path)) {
      failing.push(dir === '.' ? 'package.json' : `${dir}/package.json`);
    }
  }

  if (failing.length === 0) return true;
  return {
    ok: false,
    detail: `files field omits ${label}: ${failing.join(', ')}`,
  };
}

// endregion | Helpers
