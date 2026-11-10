import { formatGlyphLine, type OutputStyle, STATUS_GLYPHS } from '@williamthorsen/nmr-core';

import { NMR_GLYPHS } from '../glyphs.ts';
import { formatSaving } from '../helpers/duration.ts';
import type { BuildOutcome, BuildProgress } from './build.ts';

/** Renders the line that closes a build: the skip, naming the saving when it is worth naming, or the emit. */
export function renderBuildOutcome(outcome: BuildOutcome, packageName: string, style: OutputStyle): string {
  if (outcome.kind === 'unchanged') {
    const saving = formatSaving(outcome.savedMs ?? 0);
    const savingClause = saving === undefined ? '' : `, ${saving}`;
    return `${STATUS_GLYPHS[style].skipped.text} ${packageName}: No changes detected. Skipping build${savingClause}.`;
  }

  return formatGlyphLine(
    NMR_GLYPHS,
    style,
    'package',
    `${packageName}: ${describeEmit(outcome.fileCount, outcome.outdir)}`,
  );
}

/** Renders the line that announces an emit, naming why the build is about to run. */
export function renderBuildProgress(progress: BuildProgress, packageName: string, style: OutputStyle): string {
  const message = progress.kind === 'output-missing' ? 'Build output is missing. Rebuilding.' : 'Changes detected.';
  return formatGlyphLine(NMR_GLYPHS, style, 'package', `${packageName}: ${message}`);
}

// region | Helpers

/** Describes the outcome of an emit: the files that it published, or their absence. */
function describeEmit(fileCount: number, outdir: string): string {
  if (fileCount === 0) {
    return 'Did not emit any output.';
  }

  // Always plural: Every emitting source yields a `.js` and a `.d.ts`, so the count is never one.
  return `Compiled ${fileCount} files to ${outdir.replace(/\/+$/u, '')}.`;
}

// endregion | Helpers
