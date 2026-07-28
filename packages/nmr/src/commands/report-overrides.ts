import { getPnpmOverrides, readPackageJson } from '../helpers/package-json.ts';

/**
 * Reports any active pnpm dependency overrides in the monorepo root package.json.
 * Runs ahead of the report produced by the root `upgrade` script.
 */
export function reportOverrides(monorepoRoot: string): void {
  const pkg = readPackageJson(monorepoRoot);
  const overrides = getPnpmOverrides(pkg);

  if (!overrides || Object.keys(overrides).length === 0) {
    return;
  }

  console.warn('🔒 WARN: pnpm overrides are active! Check whether these are still needed:');
  for (const [name, version] of Object.entries(overrides)) {
    console.warn(`- ${name} → ${version}`);
  }
}
