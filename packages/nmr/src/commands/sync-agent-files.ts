import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VERSION } from '../version.js';

const PACKAGE_NAME = '@williamthorsen/nmr';
const DESTINATION_RELATIVE_PATH = '.agents/nmr/AGENTS.md';
const SOURCE_FILENAME = 'AGENTS.md';

/**
 * Absolute path to the source AGENTS.md bundled with the installed nmr package.
 * Walks up from this file's directory until it finds a sibling AGENTS.md, so
 * the same code works whether invoked from compiled dist (3 levels up) or from
 * source during tests (2 levels up).
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

function getDestinationPath(destinationDir: string): string {
  return path.join(destinationDir, DESTINATION_RELATIVE_PATH);
}

function currentSourceStamp(): string {
  return `${PACKAGE_NAME}@${VERSION}`;
}

/** Matches a leading frontmatter block; capture group 1 is the body between the `---` fences. */
const FRONTMATTER_REGEX = /^---\n((?:.*\n)*?)---\n/;

/** Strip leading frontmatter block from a file body, if present. */
function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_REGEX, '');
}

/** Extract the `source:` value from a file's frontmatter, or null if absent/malformed. */
export function parseSourceStamp(content: string): string | null {
  const frontmatterMatch = FRONTMATTER_REGEX.exec(content);
  if (!frontmatterMatch) return null;
  const frontmatterBody = frontmatterMatch[1] ?? '';
  const sourceMatch = /^source:\s*['"]([^'"]+)['"]\s*$/m.exec(frontmatterBody);
  return sourceMatch?.[1] ?? null;
}

export interface SyncResult {
  written: string;
  stamp: string;
}

/**
 * Copies the bundled AGENTS.md into `{destinationDir}/.agents/nmr/AGENTS.md`,
 * replacing the source frontmatter with a fresh version stamp. Overwrites
 * unconditionally and creates parent directories as needed.
 */
export function sync(destinationDir: string): SyncResult {
  const sourcePath = getSourcePath();
  const sourceContent = readFileSync(sourcePath, 'utf8');
  const body = stripFrontmatter(sourceContent);
  const stamp = currentSourceStamp();
  const output = `---\nsource: '${stamp}'\n---\n${body}`;

  const destinationPath = getDestinationPath(destinationDir);
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  writeFileSync(destinationPath, output, 'utf8');

  return { written: destinationPath, stamp };
}

export type CheckResult = { ok: true; stamp: string } | { ok: false; reason: string };

/**
 * Verifies that `{destinationDir}/.agents/nmr/AGENTS.md` exists, has a well-formed
 * frontmatter stamp, and matches the installed nmr version.
 */
export function check(destinationDir: string): CheckResult {
  const destinationPath = getDestinationPath(destinationDir);
  const expected = currentSourceStamp();

  if (!existsSync(destinationPath)) {
    return {
      ok: false,
      reason: `${DESTINATION_RELATIVE_PATH} is missing. Run \`nmr sync-agent-files\`.`,
    };
  }

  const content = readFileSync(destinationPath, 'utf8');
  const found = parseSourceStamp(content);

  if (found === null) {
    return {
      ok: false,
      reason: `Cannot parse version stamp in ${DESTINATION_RELATIVE_PATH}. Run \`nmr sync-agent-files\`.`,
    };
  }

  if (found !== expected) {
    return {
      ok: false,
      reason: `${DESTINATION_RELATIVE_PATH} is out of sync (file: ${found}, installed: ${expected}). Run \`nmr sync-agent-files\`.`,
    };
  }

  return { ok: true, stamp: expected };
}
