import path from 'node:path';

import { formatDiagnostics, getCompiler } from './compiler.ts';
import { isRelativeSpecifier } from './rewrite-specifiers.ts';

/**
 * Resolves a package's full tsconfig `extends` chain, returning every config file in it (the leaf `tsconfig.json` and
 * each base that it transitively extends, up to the repo root) as paths relative to `packageDir`.
 * Emit is driven by the fully-resolved compiler options, so the base configs must be in the cache's hashed input
 * set; otherwise a change to a base config would not bust the cache and stale output could be released. The
 * relative paths give `computeBuildHash` a location-independent path string to fold into the digest.
 */
export function resolveTsconfigChain(packageDir: string, configFileName = 'tsconfig.json'): string[] {
  const ts = getCompiler();
  const resolvedChain: string[] = [];
  const seen = new Set<string>();

  /** Records a config file and recurses into each config that it extends, visiting each file once. */
  function walk(configPath: string): void {
    const normalizedPath = path.resolve(configPath);
    if (seen.has(normalizedPath)) {
      return;
    }
    seen.add(normalizedPath);
    resolvedChain.push(normalizedPath);

    const configFile = ts.readConfigFile(normalizedPath, (fileName) => ts.sys.readFile(fileName));
    if (configFile.error) {
      throw new Error(`nmr-compile: failed to read ${normalizedPath}.\n${formatDiagnostics([configFile.error])}`);
    }

    for (const entry of normalizeExtendsField(configFile.config)) {
      walk(resolveExtendsTarget(entry, normalizedPath));
    }
  }

  walk(path.resolve(packageDir, configFileName));
  return resolvedChain.map((absolute) => path.relative(packageDir, absolute));
}

// region | Helpers

/** Normalizes a parsed tsconfig's `extends` field (absent, a single path, or an array) to a string array. */
function normalizeExtendsField(config: unknown): string[] {
  if (config === null || typeof config !== 'object' || !('extends' in config)) {
    return [];
  }
  const extendsField: unknown = config.extends;
  if (typeof extendsField === 'string') {
    return [extendsField];
  }
  if (Array.isArray(extendsField)) {
    return extendsField.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

/**

 * Resolves a single tsconfig `extends` entry to an absolute config-file path. Relative and absolute
 * entries resolve against the extending config's directory, appending `.json` when the bare path does
 * not exist; package-specifier entries resolve through Node module resolution. Throws when an entry
 * cannot be located.
 */
function resolveExtendsTarget(extendsEntry: string, fromConfigPath: string): string {
  const ts = getCompiler();
  if (isRelativeSpecifier(extendsEntry) || path.isAbsolute(extendsEntry)) {
    const base = path.resolve(path.dirname(fromConfigPath), extendsEntry);
    if (ts.sys.fileExists(base)) {
      return base;
    }
    const withJsonExtension = `${base}.json`;
    if (ts.sys.fileExists(withJsonExtension)) {
      return withJsonExtension;
    }
    throw new Error(`nmr-compile: ${fromConfigPath} extends '${extendsEntry}', which does not exist.`);
  }

  // A package that does not declare an `exports` map is reachable only at its `tsconfig.json` path,
  // which is what TypeScript's own config resolver falls back to.
  const resolvedPath =
    resolvePackageSpecifier(extendsEntry, fromConfigPath) ??
    resolvePackageSpecifier(`${extendsEntry}/tsconfig.json`, fromConfigPath);
  if (resolvedPath === undefined) {
    throw new Error(`nmr-compile: ${fromConfigPath} extends '${extendsEntry}', which does not resolve to a file.`);
  }
  return resolvedPath;
}

/** Resolves a package specifier to a file through Node module resolution, or `undefined` when it does not resolve. */
function resolvePackageSpecifier(specifier: string, fromConfigPath: string): string | undefined {
  const ts = getCompiler();
  const { resolvedModule } = ts.resolveModuleName(
    specifier,
    fromConfigPath,
    { moduleResolution: ts.ModuleResolutionKind.NodeNext, resolveJsonModule: true },
    ts.sys,
  );
  return resolvedModule?.resolvedFileName;
}

// endregion | Helpers
