import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';

/**
 * Builds a fixture repo declaring a root manifest and a `packages/*` workspace glob, returning its directory.
 *
 * readyup's workspace discovery reads both and throws where the root manifest is absent, so a check built on it
 * cannot be exercised against the bare tree `buildRepo` produces. A path named in `files` wins, so a test needing
 * a different workspace glob states its own.
 */
export function buildMonorepo(files: Record<string, string>): string {
  return buildRepo({
    'package.json': '{ "name": "fixture-root", "private": true }\n',
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    ...files,
  });
}

/**
 * Builds a fixture repo in a temp directory from a map of repo-relative paths to file contents, returning its
 * directory. Parent directories are created as needed, so a map may name a nested path directly. The directory is
 * removed when the calling test finishes, so this must be called from a test body or a per-test hook, never from
 * `beforeAll`.
 *
 * Temp directories rather than committed fixtures: a fixture carries the very shape the check under test looks
 * for, so committing one turns this repo into a target of its own checks. A `*.integration.test.ts` under any
 * `__tests__/` would be collected by the `unit` project, and a `package.json` declaring a `pnpm` field would be
 * reported by the check that rejects one.
 */
export function buildRepo(files: Record<string, string>): string {
  return disposeOnTestFinished(createTempTree(files, { prefix: 'nmr-kit-' })).dir;
}
