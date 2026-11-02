import { isRecord } from './typeGuards.ts';

/** A path that a manifest names but the tarball lacks, with the manifest location that names it. */
export interface MissingManifestPath {
  location: string;
  path: string;
}

/** The export condition exempt in every repo: a development entry that resolves to unpublished source. */
const BUILT_IN_DEV_CONDITION = 'source';

/**
 * Lists each path named by the manifest's `main`, `types`, `bin`, and `exports` that `packedFiles` lacks.
 *
 * `packedFiles` holds tarball entries relative to the package root. `main` resolves as Node resolves it: the path
 * itself, then with `.js` or `.json` appended, then as a directory containing `index.js`. An `exports` target
 * containing `*` passes when any entry matches it, with `*` spanning `/` as in Node's subpath patterns. A target under
 * `source` or under one of `devExportConditions` is exempt, at any depth.
 */
export function findMissingManifestPaths(
  manifest: Record<string, unknown>,
  packedFiles: readonly string[],
  devExportConditions: readonly string[],
): MissingManifestPath[] {
  const packedSet = new Set(packedFiles);
  const exemptConditions = new Set([BUILT_IN_DEV_CONDITION, ...devExportConditions]);
  const missingPaths: MissingManifestPath[] = [];

  const main = manifest['main'];
  if (typeof main === 'string' && listMainCandidates(main).every((candidate) => !packedSet.has(candidate))) {
    missingPaths.push({ location: 'main', path: main });
  }

  const types = manifest['types'];
  if (typeof types === 'string' && !packedSet.has(normalizePath(types))) {
    missingPaths.push({ location: 'types', path: types });
  }

  const binTargets = listBinTargets(manifest['bin']);
  for (const { location, path } of binTargets) {
    if (!packedSet.has(normalizePath(path))) {
      missingPaths.push({ location, path });
    }
  }

  const exportTargets: Array<{ location: string; path: string }> = [];
  collectExportTargets(manifest['exports'], 'exports', exemptConditions, exportTargets);
  for (const target of exportTargets) {
    if (!isTargetPacked(target.path, packedFiles, packedSet)) {
      missingPaths.push(target);
    }
  }

  return missingPaths;
}

// region | Helpers

/** Walks an `exports` value, collecting each string target with its location and skipping exempt conditions. */
function collectExportTargets(
  value: unknown,
  location: string,
  exemptConditions: ReadonlySet<string>,
  targets: Array<{ location: string; path: string }>,
): void {
  if (typeof value === 'string') {
    targets.push({ location, path: value });
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, element] of value.entries()) {
      collectExportTargets(element, `${location}[${index}]`, exemptConditions, targets);
    }
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key.startsWith('.')) {
      collectExportTargets(nestedValue, `${location}[${JSON.stringify(key)}]`, exemptConditions, targets);
    } else if (!exemptConditions.has(key)) {
      collectExportTargets(nestedValue, `${location}.${key}`, exemptConditions, targets);
    }
  }
}

/** Reports whether a target, exact or a `*` pattern, names at least one packed entry. */
function isTargetPacked(target: string, packedFiles: readonly string[], packedSet: ReadonlySet<string>): boolean {
  const normalizedTarget = normalizePath(target);
  if (!normalizedTarget.includes('*')) {
    return packedSet.has(normalizedTarget);
  }

  const pattern = new RegExp(
    `^${normalizedTarget
      .split('*')
      .map((part) => RegExp.escape(part))
      .join('.*')}$`,
  );
  return packedFiles.some((file) => pattern.test(file));
}

/** Lists the `bin` field's targets: one for a string, one per command for a map. */
function listBinTargets(bin: unknown): Array<{ location: string; path: string }> {
  if (typeof bin === 'string') {
    return [{ location: 'bin', path: bin }];
  }
  if (!isRecord(bin)) return [];

  const targets: Array<{ location: string; path: string }> = [];
  for (const [command, path] of Object.entries(bin)) {
    if (typeof path === 'string') {
      targets.push({ location: `bin.${command}`, path });
    }
  }
  return targets;
}

/** Lists the files that Node tries for a `main` value, in resolution order. */
function listMainCandidates(main: string): string[] {
  const normalizedMain = normalizePath(main);
  const directoryPrefix = normalizedMain === '' ? '' : `${normalizedMain}/`;
  const indexCandidates = [`${directoryPrefix}index.js`, `${directoryPrefix}index.json`];
  if (normalizedMain === '') return indexCandidates;

  return [normalizedMain, `${normalizedMain}.js`, `${normalizedMain}.json`, ...indexCandidates];
}

/** Strips the leading `./` or `/` and any trailing `/`, so that a manifest path compares with a tarball entry. */
function normalizePath(path: string): string {
  return path
    .replace(/^\.?\/+/, '')
    .replace(/^\.$/, '')
    .replace(/\/+$/, '');
}

// endregion | Helpers
