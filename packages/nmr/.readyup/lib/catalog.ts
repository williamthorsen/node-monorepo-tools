import { posix } from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';
import type { CheckOutcome } from 'readyup';
import { isRecord, type Workspace } from 'readyup/check-utils';
import { parse } from 'yaml';

import { discoverWorkspacesOrFailure, formatPaths, readFileIn } from './repo-files.ts';

/** Manifest fields whose catalogued entries must use `catalog:`. A peer range differs from the pin by design. */
const CATALOGUE_CHECKED_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

/** Matches a specifier that names a protocol, such as `catalog:`, `workspace:`, `npm:`, or `git+ssh:`. */
const PROTOCOL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/** A literal specifier declared for a catalogued dependency. */
interface CatalogFinding {
  manifestPath: string;
  name: string;
  specifier: string;
}

type CatalogRead = { ok: true; names: ReadonlySet<string> } | { ok: false; detail: string };

/**
 * Checks that every manifest, the root's included, declares a dependency named by a pnpm catalog as `catalog:`
 * rather than as a literal version.
 *
 * Reads the repo's workspaces from `process.cwd()`, because readyup's discovery offers no other anchor.
 *
 * @internal - Exported only to enable testing
 */
export function cataloguedDependenciesUseCatalog(): boolean | CheckOutcome {
  const catalogRead = readCataloguedNames(process.cwd());
  if (!catalogRead.ok) return catalogRead;
  if (catalogRead.names.size === 0) return true;

  const workspaceDiscovery = discoverWorkspacesOrFailure();
  if (!workspaceDiscovery.ok) return workspaceDiscovery;

  const findings = workspaceDiscovery.workspaces
    .flatMap((workspace) => findLiteralCataloguedSpecifiers(workspace, catalogRead.names))
    .toSorted((a, b) => a.manifestPath.localeCompare(b.manifestPath) || a.name.localeCompare(b.name));
  if (findings.length === 0) return true;

  const lines = findings.map(({ manifestPath, name, specifier }) => `${manifestPath}: ${name} ${specifier}`);
  return { ok: false, detail: formatPaths([...new Set(lines)]) };
}

// region | Helpers

/**
 * Returns the catalogued dependencies that a workspace's manifest declares with a specifier naming no protocol.
 *
 * A specifier that is not a string is skipped: A malformed manifest is pnpm's to report.
 */
function findLiteralCataloguedSpecifiers(workspace: Workspace, names: ReadonlySet<string>): CatalogFinding[] {
  const manifestPath = posix.join(workspace.dir, 'package.json');

  return CATALOGUE_CHECKED_FIELDS.flatMap((field) => {
    const declared = workspace.packageJson[field];
    if (!isRecord(declared)) return [];

    return Object.entries(declared).flatMap(([name, specifier]) =>
      names.has(name) && typeof specifier === 'string' && !PROTOCOL_PATTERN.test(specifier)
        ? { manifestPath, name, specifier }
        : [],
    );
  });
}

/**
 * Returns every package name listed by the default `catalog` or by a named catalog under `catalogs` in
 * `pnpm-workspace.yaml`, which is empty when the file is absent or declares neither.
 *
 * A file that does not parse is a failure rather than an empty set, which would pass a repo that was never checked.
 * A catalog that is not a map is skipped.
 */
function readCataloguedNames(cwd: string): CatalogRead {
  const content = readFileIn(cwd, 'pnpm-workspace.yaml');
  if (content === undefined) return { ok: true, names: new Set() };

  let workspaceManifest: unknown;
  try {
    workspaceManifest = parse(content);
  } catch (error) {
    return { ok: false, detail: `cannot parse pnpm-workspace.yaml: ${describeError(error)}` };
  }
  if (!isRecord(workspaceManifest)) return { ok: true, names: new Set() };

  const namedCatalogs = workspaceManifest['catalogs'];
  const catalogs = [workspaceManifest['catalog'], ...(isRecord(namedCatalogs) ? Object.values(namedCatalogs) : [])];

  return { ok: true, names: new Set(catalogs.filter(isRecord).flatMap((catalog) => Object.keys(catalog))) };
}

// endregion | Helpers
