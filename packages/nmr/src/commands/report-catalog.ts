import { findContainingPackageDir } from '../context.ts';
import { DEPENDENCY_FIELDS, readPackageJson } from '../helpers/package-json.ts';
import { findMonorepoRoot, getWorkspacePackageDirs } from '../workspace.ts';

/** The protocol marking a specifier whose version comes from a `pnpm-workspace.yaml` catalog. */
const CATALOG_PROTOCOL = 'catalog:';

interface CataloguedDependency {
  name: string;
  specifier: string;
}

/**
 * Reports the catalogued dependencies a package-scoped upgrade pass cannot see.
 *
 * The upgrade tool reads `pnpm-workspace.yaml` only when it sits at the working directory, so a pass run
 * inside a package drops every dependency a catalog declares -- and a package whose dependencies are all
 * catalogued reports itself up to date. Naming them, and the root a covering pass runs from, is what keeps
 * that from reading as a clean bill of health.
 *
 * Runs ahead of the report produced by the workspace `upgrade` script.
 */
export function reportCatalog(cwd: string): void {
  const monorepoRoot = findMonorepoRoot(cwd);
  const packageDir = findContainingPackageDir(cwd, getWorkspacePackageDirs(monorepoRoot));

  // A root-scoped pass reads the catalog itself, so it has nothing to be told.
  if (packageDir === undefined) {
    return;
  }

  const dependencies = findCataloguedDependencies(packageDir);
  if (dependencies.length === 0) {
    return;
  }

  const subject = dependencies.length === 1 ? '1 dependency comes' : `${dependencies.length} dependencies come`;
  console.warn(`📚 WARN: ${subject} from a catalog, which a package-scoped upgrade does not read:`);
  for (const { name, specifier } of dependencies) {
    console.warn(`- ${name} → ${specifier}`);
  }
  console.warn(`Run \`nmr upgrade\` from ${monorepoRoot} to include them.`);
}

// region | Helpers

/**
 * Returns the package's catalogued dependencies ordered by name, one entry per name.
 *
 * A package may declare the same dependency in more than one field -- a peer range beside a dev pin is the
 * common pair -- and the reader is owed one line per dependency rather than one per declaration.
 */
function findCataloguedDependencies(packageDir: string): CataloguedDependency[] {
  const pkg = readPackageJson(packageDir);
  const found = new Map<string, string>();

  for (const field of DEPENDENCY_FIELDS) {
    const declared = Object.entries(pkg[field] ?? {});
    for (const [name, specifier] of declared) {
      if (specifier.startsWith(CATALOG_PROTOCOL) && !found.has(name)) {
        found.set(name, specifier);
      }
    }
  }

  return [...found].map(([name, specifier]) => ({ name, specifier })).toSorted((a, b) => a.name.localeCompare(b.name));
}

// endregion | Helpers
