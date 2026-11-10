import process from 'node:process';

import { formatGlyphLine, type OutputStyle } from '@williamthorsen/nmr-core';
import { defineCommand, runCli } from '@williamthorsen/nmr-core/cli';

import { NMR_REPORT_CATALOG_BIN } from '../bins.ts';

import { findContainingPackageDir } from '../context.ts';
import { NMR_GLYPHS } from '../glyphs.ts';
import { DEPENDENCY_FIELDS, readPackageJson } from '../helpers/package-json.ts';
import { reportClosing } from '../helpers/reportClosing.ts';
import { resolveBinStyles } from '../resolveBinStyles.ts';
import { findMonorepoRoot, getWorkspacePackageDirs } from '../workspace.ts';

/** The protocol marking a specifier whose version comes from a `pnpm-workspace.yaml` catalog. */
const CATALOG_PROTOCOL = 'catalog:';

interface CataloguedDependency {
  name: string;
  specifier: string;
}

/**
 * Runs `nmr-report-catalog` against `argv` from `cwd` and returns the exit code to report. The command takes neither
 * an option nor an operand, so anything but `--help` is a usage error and reports nothing.
 */
export async function runReportCatalog(argv: string[], cwd: string): Promise<number> {
  const command = defineCommand({
    summary: 'Report the catalogued dependencies that a package-scoped upgrade does not read',
    run: () => {
      // The report goes to stderr, so it takes that stream's style.
      reportCatalog(cwd, resolveBinStyles().stderr);
      return 0;
    },
  });

  return runCli(argv, command, {
    name: NMR_REPORT_CATALOG_BIN,
    stdout: process.stdout,
    stderr: process.stderr,
    baseDir: cwd,
  });
}

/**
 * Reports the catalogued dependencies that a package-scoped upgrade pass does not read.
 *
 * The upgrade tool reads `pnpm-workspace.yaml` only when the file is in the working directory, so a pass run
 * inside a package drops every dependency declared by a catalog -- and the tool reports a package whose
 * dependencies are all catalogued as up to date. This report names them, and the root from which a covering
 * pass runs, to keep the reader from taking that result to mean that every dependency is up to date.
 */
export function reportCatalog(cwd: string, style: OutputStyle): void {
  const monorepoRoot = findMonorepoRoot(cwd);
  const packageDir = findContainingPackageDir(cwd, getWorkspacePackageDirs(monorepoRoot));

  // Skip the report for a root-scoped pass, which reads the catalog itself.
  if (packageDir === undefined) {
    return;
  }

  const dependencies = findCataloguedDependencies(packageDir);
  if (dependencies.length === 0) {
    return;
  }

  console.warn(
    formatGlyphLine(
      NMR_GLYPHS,
      style,
      'catalog',
      'WARN: A package-scoped upgrade does not read the catalogs from which these come:',
    ),
  );
  for (const { name, specifier } of dependencies) {
    console.warn(`- ${name} → ${specifier}`);
  }
  reportClosing(
    formatGlyphLine(NMR_GLYPHS, style, 'catalog', describeCatalog(dependencies.length, monorepoRoot)),
    console.warn,
  );
}

// region | Helpers

/** Summarizes the report: how many dependencies this pass left unread, and the root from which to include them. */
function describeCatalog(count: number, monorepoRoot: string): string {
  const subject = count === 1 ? '1 catalogued dependency went' : `${count} catalogued dependencies went`;
  const object = count === 1 ? 'it' : 'them';

  return `${subject} unread. Run \`nmr upgrade\` from ${monorepoRoot} to include ${object}.`;
}

/**
 * Returns the package's catalogued dependencies ordered by name, one entry per name.
 *
 * A package may declare the same dependency in more than one field -- a peer range beside a dev pin is the
 * common pair -- and the report shows one line per dependency rather than one per declaration.
 */
function findCataloguedDependencies(packageDir: string): CataloguedDependency[] {
  const packageJson = readPackageJson(packageDir);
  const foundDependencies = new Map<string, string>();

  for (const field of DEPENDENCY_FIELDS) {
    const declaredEntries = Object.entries(packageJson[field] ?? {});
    for (const [name, specifier] of declaredEntries) {
      if (specifier.startsWith(CATALOG_PROTOCOL) && !foundDependencies.has(name)) {
        foundDependencies.set(name, specifier);
      }
    }
  }

  return [...foundDependencies]
    .map(([name, specifier]) => ({ name, specifier }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

// endregion | Helpers
