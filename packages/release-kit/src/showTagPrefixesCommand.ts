import {
  formatStatusLine,
  isAnticipatedFailure,
  type OutputStyle,
  reportError,
  type StatusGlyphName,
  type StreamStyles,
} from '@williamthorsen/nmr-core';

import { BIN } from './bin.ts';
import type { UndeclaredTagPrefix } from './detectUndeclaredTagPrefixes.ts';
import { detectRepoType } from './init/detectRepoType.ts';
import { loadValidatedConfig, reportConfigProblem } from './loadValidatedConfig.ts';
import {
  previewTagPrefixes,
  type RetiredPackagePreviewEntry,
  type TagPrefixCollision,
  type TagPrefixPreview,
  type TagPrefixPreviewRow,
} from './previewTagPrefixes.ts';

/**
 * Runs the CLI `show-tag-prefixes` command and returns its exit code.
 *
 * Prints one block per target, with its derived prefix and declared legacy identities and their tag counts, then the
 * declared retired packages, the candidate-shaped tags outside the known set, and a footer on creating the first tag
 * when a target does not have any. Returns `1` on any derivation failure or collision and `0` otherwise; undeclared
 * candidates do not affect the exit code. When a config exists and either fails to load or fails validation, the
 * command reports it to stderr and returns `1` in both repo modes, because a default-config preview would understate
 * the declared legacy prefixes. When the default config is absent, the command previews against derived defaults.
 */
export async function showTagPrefixesCommand(styles: StreamStyles, configPath?: string): Promise<number> {
  // Load the config before the single-package branch, which reads none, so that an invalid config fails in both modes.
  const result = await loadValidatedConfig(configPath);
  if (result.status === 'invalid') {
    reportConfigProblem(result.problem, styles.stderr);
    return 1;
  }

  if (detectRepoType() === 'single-package') {
    process.stdout.write(renderSinglePackage());
    return 0;
  }

  let preview: TagPrefixPreview;
  try {
    preview = previewTagPrefixes(result.status === 'ok' ? result.config : undefined);
  } catch (error: unknown) {
    if (!isAnticipatedFailure(error)) {
      throw error;
    }
    reportError(BIN, error.message);
    return 1;
  }

  process.stdout.write(renderMonorepo(preview, styles.stdout));
  return computeExitCode(preview);
}

// region | Helpers

/** Width of the widest row label, to which every label is padded so that the status markers align. */
const LABEL_WIDTH = 'legacy identity'.length;

/** Explains how a workspace without derived tags gets its first tag. */
const FIRST_TAG_FOOTER =
  'A workspace marked "no derived tags yet" has not been released under its derived prefix. `release-kit tag` creates its first tag from the tags file that `release-kit prepare` writes.';

/** Column widths shared by every prefix line of the output. */
interface Columns {
  prefixWidth: number;
  countDigits: number;
}

/** Returns `1` on any derivation failure or collision and `0` otherwise; undeclared candidates are non-blocking. */
function computeExitCode(preview: TagPrefixPreview): number {
  const hasDerivationFailure = preview.workspaces.some((row) => row.derivedPrefix === null);
  const hasCollision = preview.collisions.length > 0;
  return hasDerivationFailure || hasCollision ? 1 : 0;
}

/** Renders a prefix, its right-aligned tag count, and an optional note in the shared columns. */
function formatPrefixColumns(columns: Columns, prefix: string, tagCount: number, note?: string): string {
  const cells = `${prefix.padEnd(columns.prefixWidth)}  ${String(tagCount).padStart(columns.countDigits)} tags`;
  return note === undefined ? cells : `${cells}  ${note}`;
}

/** Renders a labelled row of a target block. */
function formatRow(label: string, body: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}   ${body}`;
}

/** Measures the prefix and count columns over every derived, legacy, and retired prefix in the preview. */
function measureColumns(preview: TagPrefixPreview): Columns {
  const entries: { prefix: string; tagCount: number }[] = preview.retiredPackages.map((entry) => ({
    prefix: entry.tagPrefix,
    tagCount: entry.tagCount,
  }));
  for (const row of preview.workspaces) {
    if (row.derivedPrefix !== null) entries.push({ prefix: row.derivedPrefix, tagCount: row.derivedTagCount });
    entries.push(...row.legacyEntries);
  }
  return {
    prefixWidth: Math.max(0, ...entries.map((entry) => entry.prefix.length)),
    countDigits: Math.max(1, ...entries.map((entry) => String(entry.tagCount).length)),
  };
}

/** Renders the full monorepo preview: target blocks, retired and undeclared sections, and the first-tag footer. */
function renderMonorepo(preview: TagPrefixPreview, style: OutputStyle): string {
  const columns = measureColumns(preview);
  const lines: string[] = ['Workspace tag prefixes'];
  for (const row of preview.workspaces) {
    lines.push('', ...renderTargetBlock(row, preview.collisions, columns, style));
  }

  if (preview.retiredPackages.length > 0) {
    lines.push('', 'Retired packages', '', ...renderRetiredLines(preview.retiredPackages, columns, style));
  }

  lines.push('', 'Undeclared tag prefixes', '', ...renderUndeclaredSection(preview.undeclaredCandidates, style));

  if (preview.workspaces.some((row) => row.derivedPrefix !== null && row.derivedTagCount === 0)) {
    lines.push('', formatStatusLine(style, 'info', FIRST_TAG_FOOTER));
  }

  lines.push('');
  return lines.join('\n');
}

/** Renders one line per retired package: its prefix, tag count, name, and successor when declared. */
function renderRetiredLines(
  retiredPackages: readonly RetiredPackagePreviewEntry[],
  columns: Columns,
  style: OutputStyle,
): string[] {
  return retiredPackages.map((entry) => {
    const identity = entry.successor === undefined ? entry.name : `${entry.name}, successor: ${entry.successor}`;
    const status = entry.tagCount > 0 ? 'passed' : 'warning';
    return `  ${formatStatusLine(style, status, formatPrefixColumns(columns, entry.tagPrefix, entry.tagCount, identity))}`;
  });
}

/** Renders the single-package output: one block with the root's `v` prefix. */
function renderSinglePackage(): string {
  const lines: string[] = [
    'Workspace tag prefixes',
    '',
    '. (single-package mode)',
    formatRow('derived prefix', 'v'),
    '',
  ];
  return lines.join('\n');
}

/** Renders a paste-ready `workspaces: [ ... ]` config snippet for the undeclared candidates. */
function renderSuggestedSnippet(candidates: readonly { prefix: string; suggestedDir: string }[]): string {
  const entries = candidates
    .map(
      (candidate) =>
        `    { dir: '${candidate.suggestedDir}', legacyIdentities: [{ name: 'TODO-fill-in-legacy-npm-name', tagPrefix: '${candidate.prefix}' }] },`,
    )
    .join('\n');
  return `  workspaces: [\n${entries}\n  ],`;
}

/** Renders a target's block: its title, its derived-prefix row, and one row per legacy identity. */
function renderTargetBlock(
  row: TagPrefixPreviewRow,
  collisions: readonly TagPrefixCollision[],
  columns: Columns,
  style: OutputStyle,
): string[] {
  const lines = [row.name === null ? row.workspacePath : `${row.workspacePath} (${row.name})`];
  if (row.derivedPrefix === null) {
    const failure = formatStatusLine(style, 'failed', `derivation failed: ${row.derivationError ?? 'unknown error'}`);
    lines.push(formatRow('derived prefix', failure));
    return lines;
  }

  const collidingPaths = collisions
    .filter((collision) => collision.tagPrefix === row.derivedPrefix)
    .flatMap((collision) => collision.workspacePaths)
    .filter((path) => path !== row.workspacePath);
  let derivedStatus: StatusGlyphName = 'passed';
  let derivedNote: string | undefined;
  if (collidingPaths.length > 0) {
    derivedStatus = 'failed';
    derivedNote = `collides with ${collidingPaths.join(', ')}`;
  } else if (row.derivedTagCount === 0) {
    derivedStatus = 'warning';
    derivedNote = 'no derived tags yet';
  }
  const derivedCells = formatPrefixColumns(columns, row.derivedPrefix, row.derivedTagCount, derivedNote);
  lines.push(formatRow('derived prefix', formatStatusLine(style, derivedStatus, derivedCells)));

  for (const entry of row.legacyEntries) {
    const status = entry.tagCount > 0 ? 'passed' : 'warning';
    const legacyCells = formatPrefixColumns(columns, entry.prefix, entry.tagCount, entry.name);
    lines.push(formatRow('legacy identity', formatStatusLine(style, status, legacyCells)));
  }
  return lines;
}

/** Renders the undeclared candidates with a paste-ready config snippet, or `(none)` when the scan found none. */
function renderUndeclaredSection(candidates: readonly UndeclaredTagPrefix[], style: OutputStyle): string[] {
  if (candidates.length === 0) return ['  (none)'];
  return [
    ...candidates.map(
      (candidate) =>
        `  ${formatStatusLine(style, 'warning', `'${candidate.prefix}': ${candidate.tagCount} tags (e.g., ${candidate.exampleTags.join(', ')})`)}`,
    ),
    '',
    'Suggested config snippet (adjust `dir` to match the workspace if the guess is wrong, and replace the `name` placeholder with the legacy npm name):',
    '',
    renderSuggestedSnippet(candidates),
    '',
    "If the suggested `dir` does not match the workspace, adjust it before pasting. Each legacy identity requires a `name`: Replace the `TODO-fill-in-legacy-npm-name` placeholder with the package's prior npm name.",
  ];
}

// endregion | Helpers
