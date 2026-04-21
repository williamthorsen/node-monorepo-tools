// list-workspaces.mjs — Emit `<dir>\t<unscoped package name>` for every
// pnpm workspace discovered from `pnpm-workspace.yaml`.
//
// Companion to `migrate-tag-prefixes.sh`. Reads the workspace file from the
// current working directory, expands its `packages` globs, reads each
// workspace's `package.json`, strips any leading `@scope/` from the name, and
// writes one tab-separated line per workspace to stdout. All errors go to
// stderr and cause a non-zero exit.
//
// The script intentionally duplicates the trivial `stripNpmScope` logic from
// the release-kit TypeScript source so it has no dependency on compiled
// output in `dist/`.

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';

import { glob } from 'glob';
import { load } from 'js-yaml';

const WORKSPACE_FILE = 'pnpm-workspace.yaml';

async function main() {
  if (!existsSync(WORKSPACE_FILE)) {
    fail(`workspace file not found: ${WORKSPACE_FILE} (run from the repo root)`);
  }

  const patterns = readWorkspacePatterns(WORKSPACE_FILE);
  const directories = await expandPatterns(patterns);

  const lines = [];
  for (const dir of directories) {
    const unscopedName = readUnscopedPackageName(dir);
    lines.push(`${basename(dir)}\t${unscopedName}`);
  }

  // Sort for stable output regardless of glob traversal order.
  lines.sort();

  for (const line of lines) {
    console.log(line);
  }
}

// Read and parse `pnpm-workspace.yaml`, returning its `packages` globs.
function readWorkspacePatterns(workspaceFile) {
  let content;
  try {
    content = readFileSync(workspaceFile, 'utf8');
  } catch (error) {
    fail(`failed to read ${workspaceFile}: ${errorMessage(error)}`);
  }

  let parsed;
  try {
    parsed = load(content);
  } catch (error) {
    fail(`failed to parse ${workspaceFile}: ${errorMessage(error)}`);
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.packages)) {
    fail(`${workspaceFile} has no 'packages' list`);
  }

  const patterns = parsed.packages.filter((pattern) => typeof pattern === 'string');
  if (patterns.length === 0) {
    fail(`${workspaceFile} has no workspace glob patterns`);
  }

  return patterns;
}

// Expand workspace globs to directories that contain a `package.json`.
async function expandPatterns(patterns) {
  const directories = new Set();
  for (const pattern of patterns) {
    const matches = await glob(pattern, { posix: true });
    for (const match of matches) {
      if (existsSync(join(match, 'package.json'))) {
        directories.add(match);
      }
    }
  }
  // eslint-disable-next-line unicorn/no-array-sort -- toSorted requires Node 20+; engine target is >=18.17.0
  return [...directories].sort();
}

// Read the workspace's `package.json` and return the unscoped package name.
function readUnscopedPackageName(workspaceDir) {
  const packageJsonPath = join(workspaceDir, 'package.json');

  let raw;
  try {
    raw = readFileSync(packageJsonPath, 'utf8');
  } catch (error) {
    fail(`failed to read ${packageJsonPath}: ${errorMessage(error)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`failed to parse ${packageJsonPath}: ${errorMessage(error)}`);
  }

  const name = isRecord(parsed) ? parsed.name : undefined;
  if (typeof name !== 'string' || name.length === 0) {
    fail(`${packageJsonPath} is missing a 'name' field`);
  }

  return stripNpmScope(name);
}

// Strip a leading `@scope/` from an npm package name.
//
// Duplicates the tiny helper in release-kit's `component.ts`. Inlining avoids
// a dependency on compiled TypeScript output from `dist/`.
function stripNpmScope(name) {
  if (name.startsWith('@') && name.includes('/')) {
    return name.slice(name.indexOf('/') + 1);
  }
  return name;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// Print an error to stderr and exit non-zero.
function fail(message) {
  process.stderr.write(`list-workspaces: ${message}\n`);
  process.exit(1);
}

try {
  await main();
} catch (error) {
  fail(errorMessage(error));
}
