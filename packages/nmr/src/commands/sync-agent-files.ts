import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readPackageVersion } from '@williamthorsen/nmr-core';

const VERSION = readPackageVersion(import.meta.url);

const PACKAGE_NAME = '@williamthorsen/nmr';
const DESTINATION_RELATIVE_PATH = '.agents/nmr/AGENTS.md';
const SOURCE_FILENAME = 'AGENTS.md';

/** Matches a leading frontmatter block; capture group 1 is the body between the `---` fences. */
const FRONTMATTER_REGEX = /^---\n((?:.*\n)*?)---\n/;

/**
 * Verifies that `{destinationDir}/.agents/nmr/AGENTS.md` exists and its body (frontmatter stripped) matches the body
 * the installed nmr version renders. Gates on content only; the `source:` package specifier is informational and not
 * compared.
 */
export function check(destinationDir: string): CheckResult {
  const destinationPath = getDestinationPath(destinationDir);

  if (!existsSync(destinationPath)) {
    return {
      ok: false,
      reason: `${DESTINATION_RELATIVE_PATH} is missing. Run \`nmr sync-agent-files\`.`,
    };
  }

  const expectedBody = stripFrontmatter(readFileSync(getSourcePath(), 'utf8'));
  const foundBody = stripFrontmatter(readFileSync(destinationPath, 'utf8'));

  if (foundBody !== expectedBody) {
    return {
      ok: false,
      reason: `${DESTINATION_RELATIVE_PATH} content is out of date. Run \`nmr sync-agent-files\`.`,
    };
  }

  return { ok: true };
}

export interface SyncResult {
  path: string;
  /** The installed package specifier (`name@version`); matches the file's own only when `changed` is true. */
  packageSpecifier: string;
  changed: boolean;
}

/**
 * Renders the bundled AGENTS.md into `{destinationDir}/.agents/nmr/AGENTS.md`, replacing the source frontmatter with
 * the installed package specifier. Idempotent on content: Rewrites only when the destination is missing or its body
 * differs, otherwise leaves the file (and its existing specifier) untouched. Creates parent directories as needed.
 */
export function sync(destinationDir: string): SyncResult {
  const body = stripFrontmatter(readFileSync(getSourcePath(), 'utf8'));
  const packageSpecifier = buildPackageSpecifier();
  const destinationPath = getDestinationPath(destinationDir);

  if (existsSync(destinationPath) && stripFrontmatter(readFileSync(destinationPath, 'utf8')) === body) {
    return { path: destinationPath, packageSpecifier, changed: false };
  }

  const output = `---\nsource: '${packageSpecifier}'\n---\n${body}`;
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  writeFileSync(destinationPath, output, 'utf8');

  return { path: destinationPath, packageSpecifier, changed: true };
}

export type CheckResult = { ok: true } | { ok: false; reason: string };

// region | Helpers

/** Returns the installed package specifier in `name@version` form, e.g. `@williamthorsen/nmr@0.14.2`. */
function buildPackageSpecifier(): string {
  return `${PACKAGE_NAME}@${VERSION}`;
}

/** Returns the managed AGENTS.md path within `destinationDir`. */
function getDestinationPath(destinationDir: string): string {
  return path.join(destinationDir, DESTINATION_RELATIVE_PATH);
}

/**
 * Returns the absolute path to the source AGENTS.md bundled with the installed nmr package. Walks up from this file's
 * directory until it finds a sibling AGENTS.md, so the same code works whether invoked from compiled dist (3 levels
 * up) or from source during tests (2 levels up).
 */
function getSourcePath(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, SOURCE_FILENAME);
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error(`Could not locate ${SOURCE_FILENAME} in any parent of ${fileURLToPath(import.meta.url)}`);
}

/** Returns the content with its leading frontmatter block removed, if present. */
function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_REGEX, '');
}

// endregion | Helpers
