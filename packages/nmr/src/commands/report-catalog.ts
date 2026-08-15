import { findContainingPackageDir } from '../context.ts';
import { DEPENDENCY_FIELDS, readPackageJson } from '../helpers/package-json.ts';
import { reportClosing } from '../helpers/reportClosing.ts';
import { findMonorepoRoot, getWorkspacePackageDirs } from '../workspace.ts';

const CATALOG_ICON = '📚';

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

  console.warn(`${CATALOG_ICON} WARN: A package-scoped upgrade does not read the catalogs these come from:`);
  for (const { name, specifier } of dependencies) {
    console.warn(`- ${name} → ${specifier}`);
  }
  reportClosing(`${CATALOG_ICON} ${describeCatalog(dependencies.length, monorepoRoot)}`, console.warn);
}

// region | Helpers

/** Names what the report came to: how many dependencies this pass left behind, and the root that reaches them. */
function describeCatalog(count: number, monorepoRoot: string): string {
  const subject = count === 1 ? '1 catalogued dependency went' : `${count} catalogued dependencies went`;
  const object = count === 1 ? 'it' : 'them';

  return `${subject} unread. Run \`nmr upgrade\` from ${monorepoRoot} to include ${object}.`;
}

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
