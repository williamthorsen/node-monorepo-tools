import { getPnpmOverrides, readPackageJson } from '../helpers/package-json.ts';
import { readWorkspaceOverrides } from '../workspace.ts';

/**
 * Reports any active pnpm dependency overrides declared at the monorepo root.
 *
 * pnpm accepts them in two files, and the upgrade tool proposes bumps for both, so each entry names the file
 * it was declared in rather than leaving the reader to find which one to edit.
 *
 * Runs ahead of the report produced by the root `upgrade` script.
 */
export function reportOverrides(monorepoRoot: string): void {
  const declared = [
    ...listOverrides('package.json', getPnpmOverrides(readPackageJson(monorepoRoot))),
    ...listOverrides('pnpm-workspace.yaml', readWorkspaceOverrides(monorepoRoot)),
  ];

  if (declared.length === 0) {
    return;
  }

  console.warn('🔒 WARN: pnpm overrides are active! Check whether these are still needed:');
  for (const { file, name, version } of declared) {
    console.warn(`- ${name} → ${version} (${file})`);
  }
}

// region | Helpers

/** Returns one entry per override declared in a file, ordered by package name. */
function listOverrides(
  file: string,
  overrides: Record<string, string> | undefined,
): { file: string; name: string; version: string }[] {
  return Object.entries(overrides ?? {})
    .map(([name, version]) => ({ file, name, version }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

// endregion | Helpers
