import { existsSync, readFileSync, realpathSync } from 'node:fs';
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

/** The condition this resolver exists to reach, honoured ahead of every other at each level of an `exports` map. */
const SOURCE_CONDITION = 'source';

/** The directory name whose presence in a package's real path puts it out of reach of source resolution. */
const NODE_MODULES = 'node_modules';

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
      if (importer === undefined) return;

      return resolveSourceTarget(id, importer, {
        // eslint-disable-next-line unicorn/no-this-outside-of-class -- Rollup delivers the plugin context as `this`, which is the only route to the resolving environment.
        environmentCondition: this.environment.name === 'client' ? CLIENT_CONDITION : SERVER_CONDITION,
        manifests,
        packageDirs,
      });
    },
  };
}

/** What a resolution needs beyond the specifier and its importer: the environment's condition, and the caches. */
export interface SourceResolutionContext {
  environmentCondition: string;
  /** Parsed manifests, keyed by package directory. Absent from a caller that resolves once. */
  manifests?: Map<string, unknown>;
  /** Package directories, keyed by specifier and importer directory. Absent from a caller that resolves once. */
  packageDirs?: Map<string, string | undefined>;
}

/**
 * Resolves a bare specifier to the file name by its package's `source` condition, or nothing where the condition
 * does not reach it.
 *
 * Answers a bare specifier naming a package whose real directory sits outside every `node_modules`. Every other
 * specifier returns nothing -- such as a relative or absolute path, a virtual module, a builtin, or a package under
 * `node_modules` -- so Vite resolves the specifier through its own conditions. Throws where the condition names a
 * file that does not exist, because falling through to the build output is the staleness that resolving from source
 * exists to prevent, and nothing in a run reports it.
 */
export function resolveSourceTarget(
  specifier: string,
  importer: string,
  context: SourceResolutionContext,
): string | undefined {
  const parsed = parseSpecifier(specifier);
  if (!parsed) return undefined;

  const packageDir = findPackageDir(parsed.name, path.dirname(importer), context.packageDirs);
  if (packageDir === undefined || isInsideNodeModules(packageDir)) return undefined;

  const manifest = readManifest(packageDir, context.manifests);
  if (!isObject(manifest)) return undefined;

  const matched = matchSubpath(manifest['exports'], parsed.subpath);
  if (!matched) return undefined;

  const conditions = new Set([context.environmentCondition, ...SHARED_CONDITIONS]);
  const selected = selectTarget(matched.value, conditions);
  if (!selected?.usedSource) return undefined;

  // A function replacement, because a `$` sequence in a literal one is a substitution pattern rather than text.
  const wildcard = matched.wildcard;
  const declared = wildcard === undefined ? selected.target : selected.target.replaceAll('*', () => wildcard);
  if (!declared.startsWith('./')) return undefined;

  const target = path.resolve(packageDir, declared);
  if (!existsSync(target)) {
    throw new UserError(formatMissingTarget(parsed.name, parsed.subpath, declared, target));
  }

  return target;
}

// region | Helpers

/**
 * Walks up from a directory to the package directory named by a bare specifier, without resolving the specifier itself:
 * The `exports` map the caller is about to read may not name any entry reached by the default conditions.
 */
function findPackageDir(
  name: string,
  fromDir: string,
  cache: Map<string, string | undefined> | undefined,
): string | undefined {
  const key = `${fromDir}\0${name}`;
  if (cache?.has(key)) return cache.get(key);

  let dir = fromDir;
  let found: string | undefined;

  for (;;) {
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

/** Returns the message rejecting a `source` condition that names a file the package does not hold. */
function formatMissingTarget(name: string, subpath: string, declared: string, target: string): string {
  return [
    `Package "${name}" declares a \`source\` export for "${subpath}" at "${declared}", which does not exist.`,
    `Looked for ${target}.`,
    'Point the condition at a file that exists, or remove it so the package resolves through its other conditions.',
  ].join(' ');
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

/** Splits a bare specifier into its package name and subpath, rejecting every specifier that doesn't name a package. */
function parseSpecifier(specifier: string): { name: string; subpath: string } | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('\0')) return undefined;
  if (specifier.includes(':') || isBuiltin(specifier)) return undefined;

  const segments = specifier.split('/');
  const nameLength = specifier.startsWith('@') ? 2 : 1;
  if (segments.length < nameLength || segments.includes('')) return undefined;

  const rest = segments.slice(nameLength);

  return { name: segments.slice(0, nameLength).join('/'), subpath: rest.length === 0 ? '.' : `./${rest.join('/')}` };
}

// endregion | Helpers
