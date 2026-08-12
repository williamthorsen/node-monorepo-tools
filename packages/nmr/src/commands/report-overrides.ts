import { getPnpmOverrides, readPackageJson } from '../helpers/package-json.ts';
import { UserError } from '../UserError.ts';
import { readWorkspaceOverrides } from '../workspace.ts';

/**
 * Reports the pnpm dependency overrides declared in the monorepo root's `pnpm-workspace.yaml`, and rejects a
 * `pnpm.overrides` block left behind in the root `package.json`.
 *
 * Runs ahead of the report produced by the root `upgrade` script.
 */
export function reportOverrides(monorepoRoot: string): void {
  const declared = listEntries(readWorkspaceOverrides(monorepoRoot));

  if (declared.length > 0) {
    console.warn('🔒 WARN: pnpm overrides are active! Check whether these are still needed:');
    for (const [name, version] of declared) {
      console.warn(`- ${name} → ${version}`);
    }
  }

  rejectLegacyOverrides(monorepoRoot);
}

// region | Helpers

/** Returns a record's entries ordered by key. */
function listEntries(overrides: Record<string, string> | undefined): [string, string][] {
  return Object.entries(overrides ?? {}).toSorted(([a], [b]) => a.localeCompare(b));
}

/**
 * Rejects a `pnpm.overrides` block in the root `package.json`, naming every entry it holds.
 *
 * pnpm 11 reads no setting from that field, so the block pins nothing -- while the upgrade tool, which keeps
 * its own list of dependency fields, goes on rewriting the versions in it under `--write`. That leaves a block
 * looking maintained while it governs nothing, and failing here is what keeps the write from happening.
 */
function rejectLegacyOverrides(monorepoRoot: string): void {
  const legacy = listEntries(getPnpmOverrides(readPackageJson(monorepoRoot)));

  if (legacy.length === 0) {
    return;
  }

  throw new UserError(
    [
      'pnpm 11 reads no `pnpm.overrides` from package.json, so these pin nothing while an upgrade run with `--write` goes on rewriting them:',
      ...legacy.map(([name, version]) => `- ${name} → ${version}`),
      'Move them to the `overrides` block in pnpm-workspace.yaml, quoting each version, or run `pnpx codemod run pnpm-v10-to-v11`.',
    ].join('\n'),
  );
}

// endregion | Helpers
