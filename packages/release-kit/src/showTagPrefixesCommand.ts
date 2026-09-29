import { formatStatusLine, type OutputStyle, reportError, type StreamStyles } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { detectRepoType } from './init/detectRepoType.ts';
import { loadValidatedConfig, reportConfigProblem } from './loadValidatedConfig.ts';
import { previewTagPrefixes, type TagPrefixPreview, type TagPrefixPreviewRow } from './previewTagPrefixes.ts';

/**
 * Runs the CLI `show-tag-prefixes` command and returns its exit code.
 *
 * Prints a per-workspace table of derived prefixes, tag counts, and declared legacy entries, followed by an
 * "Undeclared tag prefixes" section when candidate-shaped tags exist outside the known set. Returns `1` on any
 * derivation failure or collision and `0` otherwise; undeclared candidates do not affect the exit code. When a config
 * exists and either fails to load or fails validation, the command reports it to stderr and returns `1` in both repo
 * modes, because a default-config preview would understate the declared legacy prefixes. When the default config is
 * absent, the command previews against derived defaults.
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
    reportError(describeError(error));
    return 1;
  }

  process.stdout.write(renderMonorepo(preview, styles.stdout));
  return computeExitCode(preview);
}

/** Renders the single-package output: one row with `.` and `v`, without legacy or undeclared sections. */
function renderSinglePackage(): string {
  const lines: string[] = [
    'Workspace   Derived prefix   Status',
    '.           v                (single-package mode)',
    '',
  ];
  return lines.join('\n');
}

/** Renders the full monorepo preview: workspace table, collision footer, undeclared section. */
function renderMonorepo(preview: TagPrefixPreview, style: OutputStyle): string {
  const lines: string[] = ['Workspace tag prefixes:', ''];
  for (const row of preview.workspaces) {
    lines.push(...renderWorkspaceRow(row, style));
  }

  if (preview.collisions.length > 0) {
    lines.push(
      '',
      ...preview.collisions.map((collision) =>
        formatStatusLine(
          style,
          'failed',
          `tag prefix collision: '${collision.tagPrefix}' used by ${collision.workspacePaths.join(', ')}`,
        ),
      ),
    );
  }

  if (preview.undeclaredCandidates.length > 0) {
    lines.push(
      '',
      'Undeclared tag prefixes:',
      '',
      ...preview.undeclaredCandidates.map(
        (candidate) =>
          `  '${candidate.prefix}': ${candidate.tagCount} tags (e.g., ${candidate.exampleTags.join(', ')})`,
      ),
      '',
      'Suggested config snippet (adjust `dir` to match the workspace if the guess is wrong, and replace the `name` placeholder with the legacy npm name):',
      '',
      renderSuggestedSnippet(preview.undeclaredCandidates),
      '',
      "If the suggested `dir` does not match the workspace, adjust it before pasting. Each legacy identity requires a `name`: Replace the `TODO-fill-in-legacy-npm-name` placeholder with the package's prior npm name.",
    );
  }

  lines.push('');
  return lines.join('\n');
}

/** Renders a single workspace's lines: header with derived-prefix status, plus legacy-entry lines. */
function renderWorkspaceRow(row: TagPrefixPreviewRow, style: OutputStyle): string[] {
  const lines: string[] = [];
  if (row.derivedPrefix === null) {
    const failure = formatStatusLine(style, 'failed', `derivation failed: ${row.derivationError ?? 'unknown error'}`);
    lines.push(`  ${row.workspacePath} — ${failure}`);
    return lines;
  }

  const statusMarker =
    row.derivedTagCount > 0
      ? formatStatusLine(style, 'passed', `${row.derivedTagCount} tags`)
      : formatStatusLine(style, 'warning', 'no existing tags');
  lines.push(`  ${row.workspacePath} — derived prefix '${row.derivedPrefix}', ${statusMarker}`);

  for (const entry of row.legacyEntries) {
    if (entry.tagCount > 0) {
      const recognized = `${entry.tagCount} legacy tags with '${entry.prefix}' prefix (recognized)`;
      lines.push(`      ${formatStatusLine(style, 'passed', recognized)}`);
    } else {
      const tagless = `recorded legacy prefix '${entry.prefix}' has no tags`;
      lines.push(`      ${formatStatusLine(style, 'warning', tagless)}`);
    }
  }
  return lines;
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

/** Returns `1` on any derivation failure or collision and `0` otherwise; undeclared candidates are non-blocking. */
function computeExitCode(preview: TagPrefixPreview): number {
  const hasDerivationFailure = preview.workspaces.some((row) => row.derivedPrefix === null);
  const hasCollision = preview.collisions.length > 0;
  return hasDerivationFailure || hasCollision ? 1 : 0;
}
