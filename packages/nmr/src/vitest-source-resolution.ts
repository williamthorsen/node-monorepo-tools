import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';

import type { Plugin } from 'vite';

import { parsePackageJson } from './helpers/package-json.ts';
import { isObject } from './helpers/type-guards.ts';
import { UserError } from './UserError.ts';

/** Conditions honoured while walking an `exports` map, whichever environment is resolving. */
const SHARED_CONDITIONS = ['module', 'import', 'development', 'default'];

/** The environment-specific condition, which decides which branch of a dual-target `exports` map is taken. */
const CLIENT_CONDITION = 'browser';
const SERVER_CONDITION = 'node';

/** The condition that this resolver exists to reach, honoured ahead of every other at each level of an `exports` map. */
const SOURCE_CONDITION = 'source';

/** The directory name whose presence in a package's real path puts it out of reach of source resolution. */
const NODE_MODULES = 'node_modules';

/**
 * Extensions probed on a `source` target that names no file on its own, in Vite's own order.
 *
 * Node's `exports` resolution takes the target literally, but `source` is a bundler condition that Node never
 * reads, so a package may point it at an extensionless path or at a directory holding an index. Vite resolves
 * both, and rejecting them here would break a package that resolved before this plugin existed.
 */
const TARGET_EXTENSIONS = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'];

/**
 * Builds the plugin that resolves a package's `source` export condition, for a package whose files sit outside
 * every `node_modules`.
 *
 * The condition cannot be emitted as a `resolve.conditions` entry instead: Vitest turns the server environment's
 * conditions into `--conditions` flags on the worker process, where Node applies them to every package it
 * resolves natively. Node refuses to strip types from a file under `node_modules`, so a dependency declaring a
 * TypeScript `source` entry fails to load as soon as the condition reaches that far.
 *
 * Resolving here instead keeps the condition inside Vite, which transforms what it resolves. A package under
 * `node_modules` resolves through its remaining conditions, whatever its `exports` map declares.
 */
export function createSourceResolutionPlugin(): Plugin {
  const packageDirs = new Map<string, string | undefined>();
  const manifests = new Map<string, unknown>();

  return {
    name: 'nmr:resolve-from-source',
    // Ahead of Vite's own resolver, which would otherwise answer first and never consult the condition.
    enforce: 'pre',
    resolveId(id, importer) {
      // eslint-disable-next-line unicorn/no-this-outside-of-class -- Rollup delivers the plugin context as `this`, which is the only route to the resolving environment.
      return resolveSourceTarget(id, importer, { environmentName: this.environment.name, manifests, packageDirs });
    },
  };
}

/** What a resolution needs beyond the specifier and its importer: the resolving environment, and the caches. */
export interface SourceResolutionContext {
  /** The Vite environment resolving the specifier, which decides the environment-specific condition. */
  environmentName: string;
  /** Parsed manifests, keyed by package directory. Absent from a caller that resolves once. */
  manifests?: Map<string, unknown>;
  /** Package directories, keyed by specifier and importer directory. Absent from a caller that resolves once. */
  packageDirs?: Map<string, string | undefined>;
}

/**
 * Resolves a bare specifier to the file that its package's `source` condition names, or nothing where the condition
 * does not reach it.
 *
 * Answers a bare specifier naming a package whose real directory sits outside every `node_modules`. Every other
 * specifier returns nothing -- such as a relative or absolute path, a virtual module, a builtin, or a package under
 * `node_modules` -- so Vite resolves the specifier through its own conditions. Throws where the condition reaches no
 * file, because falling through to the build output is the staleness that resolving from source exists to prevent,
 * and nothing in a run reports it.
 *
 * A query or hash suffix is split off before the `exports` lookup and re-appended to the resolved path, as Vite
 * does, so `pkg/icon.svg?raw` matches the `./icon.svg` entry and still reaches the plugin that reads the suffix.
 */
export function resolveSourceTarget(
  specifier: string,
  importer: string | undefined,
  context: SourceResolutionContext,
): string | undefined {
  if (importer === undefined) return undefined;

  const parsed = parseSpecifier(specifier);
  if (!parsed) return undefined;

  const packageDir = findPackageDir(parsed.name, path.dirname(importer), context.packageDirs);
  if (packageDir === undefined || isInsideNodeModules(packageDir)) return undefined;

  const manifest = readManifest(packageDir, context.manifests);
  if (!isObject(manifest)) return undefined;

  const matched = matchSubpath(manifest['exports'], parsed.subpath);
  if (!matched) return undefined;

  const environmentCondition = context.environmentName === 'client' ? CLIENT_CONDITION : SERVER_CONDITION;
  const conditions = new Set([environmentCondition, ...SHARED_CONDITIONS]);
  const selected = selectTarget(matched.value, conditions);
  if (!selected?.usedSource) return undefined;

  // A function replacement, because a `$` sequence in a literal one is a substitution pattern rather than text.
  const wildcard = matched.wildcard;
  const declared = wildcard === undefined ? selected.target : selected.target.replaceAll('*', () => wildcard);
  if (!declared.startsWith('./')) return undefined;

  const declaredPath = path.resolve(packageDir, declared);
  const target = findTargetFile(declaredPath);
  if (target === undefined) {
    throw new UserError(formatMissingTarget(parsed.name, parsed.subpath, declared, declaredPath));
  }

  return `${target}${parsed.postfix}`;
}

// region | Helpers

/**
 * Walks up from a directory to the package directory named by a bare specifier, without resolving the specifier itself:
 * The `exports` map that the caller is about to read may not name any entry reached by the default conditions.
 *
 * A self-reference is answered by the importer's own package first, because a package importing itself by name
 * needs no `node_modules` link and often has none. Vite resolves it the same way.
 */
function findPackageDir(
  name: string,
  fromDir: string,
  cache: Map<string, string | undefined> | undefined,
): string | undefined {
  const key = `${fromDir}\0${name}`;
  if (cache?.has(key)) return cache.get(key);

  let found = findSelfReferenceDir(name, fromDir);
  let dir = fromDir;

  while (found === undefined) {
    const candidate = path.join(dir, NODE_MODULES, name);
    if (existsSync(path.join(candidate, 'package.json'))) {
      found = realpathSync(candidate);
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  cache?.set(key, found);

  return found;
}

/**
 * Finds the package directory that a self-reference names: the importer's nearest manifest, where that manifest
 * declares `exports` and carries the specifier's own package name. Both conditions are Vite's.
 */
function findSelfReferenceDir(name: string, fromDir: string): string | undefined {
  let dir = fromDir;

  for (;;) {
    const file = path.join(dir, 'package.json');
    if (existsSync(file)) {
      const parsed = parsePackageJson(readFileSync(file, 'utf8'), file);

      return isObject(parsed) && parsed['name'] === name && parsed['exports'] !== undefined ? dir : undefined;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Finds where a query or hash suffix begins, or -1 where the specifier carries neither. */
function findSuffixIndex(specifier: string): number {
  const queryIndex = specifier.indexOf('?');
  const hashIndex = specifier.indexOf('#');

  if (queryIndex === -1) return hashIndex;
  if (hashIndex === -1) return queryIndex;

  return Math.min(queryIndex, hashIndex);
}

/**
 * Finds the file that a declared `source` target reaches: the path itself, then the path under each extension,
 * then an index under each extension. Vite probes in this order, and a target that it resolves has to resolve here.
 */
function findTargetFile(declaredPath: string): string | undefined {
  if (isFile(declaredPath)) return declaredPath;

  for (const extension of TARGET_EXTENSIONS) {
    const candidate = `${declaredPath}${extension}`;
    if (isFile(candidate)) return candidate;
  }

  for (const extension of TARGET_EXTENSIONS) {
    const candidate = path.join(declaredPath, `index${extension}`);
    if (isFile(candidate)) return candidate;
  }

  return undefined;
}

/** Returns the message rejecting a `source` condition that reaches no file the package holds. */
function formatMissingTarget(name: string, subpath: string, declared: string, target: string): string {
  return [
    `Package "${name}" declares a \`source\` export for "${subpath}" at "${declared}", which reaches no file.`,
    `Looked for ${target}, the same path under each of ${TARGET_EXTENSIONS.join(', ')}, and an index under it.`,
    'Point the condition at a file that exists, or remove it so the package resolves through its other conditions.',
  ].join(' ');
}

/** Reports whether a path names a file, which a directory target and a missing one both fail. */
function isFile(candidate: string): boolean {
  return statSync(candidate, { throwIfNoEntry: false })?.isFile() === true;
}

/** Reports whether a real path lies inside a `node_modules` directory, which is what Vitest hands to Node. */
function isInsideNodeModules(dir: string): boolean {
  return dir.split(path.sep).includes(NODE_MODULES);
}

/**
 * Finds the `exports` entry serving one subpath, by an exact key and then by the longest `*` pattern that
 * matches, as Node's own resolution does.
 *
 * An `exports` value that is not a subpath map serves the `.` subpath alone:
 * Node reads a string, an array, and an object whose keys are all conditions as the package's single entry.
 */
function matchSubpath(exportsValue: unknown, subpath: string): { value: unknown; wildcard?: string } | undefined {
  if (exportsValue === undefined) return undefined;

  if (!isObject(exportsValue) || Object.keys(exportsValue).every((key) => !key.startsWith('.'))) {
    return subpath === '.' ? { value: exportsValue } : undefined;
  }

  const exact = exportsValue[subpath];
  if (exact !== undefined) return { value: exact };

  let best: { base: string; value: unknown; wildcard: string } | undefined;

  for (const [key, value] of Object.entries(exportsValue)) {
    const star = key.indexOf('*');
    if (star === -1) continue;

    const base = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(base) || !subpath.endsWith(suffix)) continue;
    if (subpath.length < base.length + suffix.length) continue;
    if (best !== undefined && best.base.length >= base.length) continue;

    best = { base, value, wildcard: subpath.slice(base.length, subpath.length - suffix.length) };
  }

  return best && { value: best.value, wildcard: best.wildcard };
}

/**
 * Splits a specifier into its package name, its subpath, and its query or hash suffix, rejecting every specifier
 * that doesn't name a package.
 *
 * The suffix is separated because Vite looks the subpath up without it and re-appends it to whatever the lookup
 * returns. Leaving it on would send `./icon.svg?raw` into the `exports` map, where it matches a `*` pattern that
 * then expands to a path that nobody wrote.
 */
function parseSpecifier(specifier: string): { name: string; postfix: string; subpath: string } | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('\0')) return undefined;

  const suffixIndex = findSuffixIndex(specifier);
  const bare = suffixIndex === -1 ? specifier : specifier.slice(0, suffixIndex);
  if (bare.includes(':') || isBuiltin(bare)) return undefined;

  const segments = bare.split('/');
  const nameLength = bare.startsWith('@') ? 2 : 1;
  if (segments.length < nameLength || segments.includes('')) return undefined;

  const rest = segments.slice(nameLength);

  return {
    name: segments.slice(0, nameLength).join('/'),
    postfix: suffixIndex === -1 ? '' : specifier.slice(suffixIndex),
    subpath: rest.length === 0 ? '.' : `./${rest.join('/')}`,
  };
}

/** Parses and caches one package's manifest, leaving a malformed one to whatever reads it next. */
function readManifest(packageDir: string, cache: Map<string, unknown> | undefined): unknown {
  if (cache?.has(packageDir)) return cache.get(packageDir);

  const file = path.join(packageDir, 'package.json');
  const parsed = parsePackageJson(readFileSync(file, 'utf8'), file);
  cache?.set(packageDir, parsed);

  return parsed;
}

/**
 * Walks one `exports` entry to the target that it names, taking `source` ahead of every other condition at each
 * level, and reports through `usedSource` whether the winning branch passed through a `source` key.
 *
 * `resolveSourceTarget` returns the target only when `usedSource` is set. A target reached without `source` is the
 * one that Vite resolves through its own conditions, so returning it here would replace Vite's resolution with a
 * narrower copy.
 */
function selectTarget(
  value: unknown,
  conditions: ReadonlySet<string>,
): { target: string; usedSource: boolean } | undefined {
  if (typeof value === 'string') return { target: value, usedSource: false };

  if (Array.isArray(value)) {
    for (const entry of value) {
      const selected = selectTarget(entry, conditions);
      if (selected) return selected;
    }
    return undefined;
  }

  if (!isObject(value)) return undefined;

  const source = value[SOURCE_CONDITION];
  if (source !== undefined) {
    const selected = selectTarget(source, conditions);
    if (selected) return { target: selected.target, usedSource: true };
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === SOURCE_CONDITION || !conditions.has(key)) continue;

    const selected = selectTarget(entry, conditions);
    if (selected) return selected;
  }

  return undefined;
}

// endregion | Helpers
