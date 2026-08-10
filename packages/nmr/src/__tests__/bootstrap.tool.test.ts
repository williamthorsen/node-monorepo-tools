import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as ts from 'typescript';
import { assert, describe, expect, it } from 'vitest';

import { isObject, isStringRecord } from '../helpers/type-guards.ts';
import { findMonorepoRoot, getWorkspacePackageDirs } from '../workspace.ts';

/**
 * Proof that nmr-core's `prepare` can build nmr-core on a tree that holds no build output, which is what a
 * fresh clone's `pnpm install` does before any package is built.
 *
 * The subject is an environment capability the in-process suite never reaches twice over: module resolution
 * under an export condition Vitest does not pass, and Node's native type stripping, which is stricter than the
 * transform Vitest applies. Both are exercised through a real `node`.
 */

const NMR_SRC = path.resolve(import.meta.dirname, '..');

/** The bin nmr-core's `prepare` runs to build nmr-core before nmr-core's `dist` exists. */
const BOOTSTRAP_ENTRY = path.join(NMR_SRC, 'cli-build.ts');

const NMR_CORE_MANIFEST = path.resolve(NMR_SRC, '..', '..', 'nmr-core', 'package.json');

/** The export condition naming nmr-core's TypeScript source, which only the bootstrap opts into. */
const SOURCE_CONDITION = 'nmr-source';

/**
 * The names every workspace package publishes under, read from the manifests rather than inferred from a
 * scope. Third-party dependencies share the `@williamthorsen/` scope, and their build output ships in the
 * tarball, so a scope prefix names packages whose `dist` the bootstrap has no reason to have produced.
 */
const WORKSPACE_PACKAGE_NAMES = readWorkspacePackageNames();

/** The one workspace package the bootstrap imports, and the only one carrying a source condition. */
const NMR_CORE_SPECIFIER = '@williamthorsen/nmr-core';

const TSCONFIG = {
  compilerOptions: {
    allowImportingTsExtensions: true,
    declaration: true,
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    target: 'ES2022',
  },
  include: ['src/'],
};

describe('the build bootstrap', () => {
  it('reaches a workspace import, so the guards below cover something', () => {
    // A traversal that silently found nothing would let the resolution guard pass over an empty set forever.
    expect(collectWorkspaceImports().map((entry) => entry.specifier)).toContain(NMR_CORE_SPECIFIER);
  });

  it('resolves every workspace import to source rather than to build output', () => {
    // Anything in this graph resolving to a `dist` resolves to output the bootstrap has not produced yet, and
    // a fresh clone's install fails before a single package is built.
    const resolved = collectWorkspaceImports().map((entry) =>
      resolveFrom(entry.specifier, entry.fromDir, [SOURCE_CONDITION]),
    );

    expect(resolved.filter((url) => url.includes('/dist/'))).toStrictEqual([]);
  });

  it('resolves that same import to build output when the condition is absent', () => {
    // Without this the guard above would read as satisfied against a package carrying no source condition.
    const entry = collectWorkspaceImports().find((candidate) => candidate.specifier === NMR_CORE_SPECIFIER);
    assert(entry !== undefined, `the bootstrap closure does not import ${NMR_CORE_SPECIFIER}`);

    expect(resolveFrom(entry.specifier, entry.fromDir, [])).toContain('/dist/');
  });

  it('builds a package under Node type stripping alone', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'nmr-bootstrap-'));
    try {
      scaffoldPackage(fixture);

      const result = spawnSync(process.execPath, [`--conditions=${SOURCE_CONDITION}`, BOOTSTRAP_ENTRY], {
        cwd: fixture,
        encoding: 'utf8',
      });

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(existsSync(path.join(fixture, 'dist', 'esm', 'index.js'))).toBe(true);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('fails when a module it runs holds syntax the stripper cannot erase', () => {
    // Without this the case above could pass for the wrong reason: a runner blind to stripping failures would
    // report success whatever the bootstrap's own modules were written with.
    const fixture = mkdtempSync(path.join(tmpdir(), 'nmr-bootstrap-'));
    try {
      const entry = path.join(fixture, 'non-erasable.ts');
      writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
      writeFileSync(entry, 'enum Direction {\n  Up,\n}\n\nexport const value = Direction.Up;\n');

      const result = spawnSync(process.execPath, [`--conditions=${SOURCE_CONDITION}`, entry], {
        cwd: fixture,
        encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

describe("nmr-core's bootstrap wiring", () => {
  it('declares the source condition ahead of the build output it shadows', () => {
    const { conditions } = readNmrCoreWiring();

    expect(conditions.indexOf(SOURCE_CONDITION)).toBeGreaterThanOrEqual(0);
    expect(conditions.indexOf(SOURCE_CONDITION)).toBeLessThan(conditions.indexOf('default'));
  });

  it('points the source condition at a file on disk', () => {
    const { rootEntry } = readNmrCoreWiring();
    const target = rootEntry[SOURCE_CONDITION];
    assert(target !== undefined, `nmr-core declares no \`${SOURCE_CONDITION}\` condition`);

    expect(existsSync(path.resolve(path.dirname(NMR_CORE_MANIFEST), target))).toBe(true);
  });

  it('opts into the source condition when it builds itself', () => {
    // The resolution guards above prove what the condition does; nothing else proves anything passes it.
    expect(readNmrCoreWiring().prepare).toContain(`--conditions ${SOURCE_CONDITION}`);
  });
});

// region | Helpers

interface WorkspaceImport {
  /** The directory the specifier is resolved from, which is what makes the resolution the real one. */
  fromDir: string;
  specifier: string;
}

interface NmrCoreWiring {
  /** The condition keys of the root export, in declaration order, which is the order Node matches them in. */
  conditions: string[];
  prepare: string;
  rootEntry: Record<string, string>;
}

/** Returns every module reachable from the bootstrap entry through relative specifiers, the entry included. */
function collectClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file) || !existsSync(file)) {
      continue;
    }
    seen.add(file);

    for (const specifier of readSpecifiers(file)) {
      if (specifier.startsWith('.')) {
        queue.push(path.resolve(path.dirname(file), specifier));
      }
    }
  }

  return [...seen];
}

/** Returns every workspace-package specifier the bootstrap closure imports, paired with its importing directory. */
function collectWorkspaceImports(): WorkspaceImport[] {
  return collectClosure(BOOTSTRAP_ENTRY).flatMap((file) =>
    readSpecifiers(file)
      .filter((specifier) => WORKSPACE_PACKAGE_NAMES.some((name) => isPackageSpecifier(specifier, name)))
      .map((specifier) => ({ fromDir: path.dirname(file), specifier })),
  );
}

/** Reports whether `specifier` names `packageName` itself or one of its subpath exports. */
function isPackageSpecifier(specifier: string, packageName: string): boolean {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

/** Reads the nmr-core manifest fields the bootstrap depends on, failing loudly when they are not where expected. */
function readNmrCoreWiring(): NmrCoreWiring {
  const malformed = `${NMR_CORE_MANIFEST} does not carry the exports and scripts the bootstrap depends on`;
  const parsed: unknown = JSON.parse(readFileSync(NMR_CORE_MANIFEST, 'utf8'));
  if (!isObject(parsed)) {
    throw new Error(malformed);
  }

  const exportMap: unknown = parsed['exports'];
  const scripts: unknown = parsed['scripts'];
  if (!isObject(exportMap) || !isObject(scripts)) {
    throw new Error(malformed);
  }

  const rootEntry: unknown = exportMap['.'];
  const prepare: unknown = scripts['prepare'];
  if (!isStringRecord(rootEntry) || typeof prepare !== 'string') {
    throw new Error(malformed);
  }

  return { conditions: Object.keys(rootEntry), prepare, rootEntry };
}

/**
 * Returns the specifiers a module imports or re-exports, read from the parsed module rather than its text, so
 * that a specifier quoted in a comment or a string is not mistaken for an import the bootstrap issues.
 */
function readSpecifiers(file: string): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  function walk(node: ts.Node): void {
    const literal = getModuleSpecifier(node);
    if (literal !== undefined) {
      specifiers.push(literal.text);
    }
    ts.forEachChild(node, walk);
  }
  walk(sourceFile);

  return specifiers;
}

/** Extracts the module-specifier literal from a static import, a re-export, or a dynamic `import()`. */
function getModuleSpecifier(node: ts.Node): ts.StringLiteralLike | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
    return ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier : undefined;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [first] = node.arguments;
    return first !== undefined && ts.isStringLiteralLike(first) ? first : undefined;
  }

  return undefined;
}

/** Returns the `name` of every package the workspace manifest claims, which is what makes a specifier local. */
function readWorkspacePackageNames(): string[] {
  return getWorkspacePackageDirs(findMonorepoRoot(import.meta.dirname)).map((dir) => {
    const parsed: unknown = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (!isObject(parsed) || typeof parsed['name'] !== 'string') {
      throw new Error(`${dir} holds no package.json carrying a name`);
    }
    return parsed['name'];
  });
}

/** Resolves `specifier` the way a module in `fromDir` would, under the given export conditions. */
function resolveFrom(specifier: string, fromDir: string, conditions: string[]): string {
  const args = [
    ...conditions.map((condition) => `--conditions=${condition}`),
    '--input-type=module',
    '--eval',
    `process.stdout.write(import.meta.resolve(${JSON.stringify(specifier)}))`,
  ];
  const { status, stdout, stderr } = spawnSync(process.execPath, args, { cwd: fromDir, encoding: 'utf8' });
  if (status !== 0) {
    throw new Error(`could not resolve '${specifier}' from ${fromDir}: ${stderr}`);
  }

  return stdout;
}

/** Writes the smallest package `nmr-compile` will build: a manifest, a tsconfig, and one emitting source file. */
function scaffoldPackage(dir: string): void {
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
  writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(TSCONFIG));
  // Its own node_modules, so the build cache lands inside the temp tree rather than an ancestor of the OS
  // temp root, and is removed with it.
  mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const value: number = 1;\n');
}

// endregion | Helpers
