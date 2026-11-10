import path from 'node:path';

import { formatGlyphLine, type OutputStyle } from '@williamthorsen/nmr-core';

import { NMR_GLYPHS } from '../glyphs.ts';
import type { CleanOutcome, CleanProgress } from './clean.ts';

/** Renders the line that closes a sweep, or `undefined` for a one-package clean, whose own line concludes it. */
export function renderCleanOutcome(outcome: CleanOutcome, style: OutputStyle): string | undefined {
  if (outcome.kind === 'package') {
    return undefined;
  }

  return formatGlyphLine(NMR_GLYPHS, style, 'clean', describeSweep(outcome.cleanedDirs.length, outcome.skippedCount));
}

/** Renders the line that reports a completed step of a clean. */
export function renderCleanProgress(progress: CleanProgress, style: OutputStyle): string {
  const message =
    progress.kind === 'check-results-removed'
      ? 'Removed all recorded check results.'
      : `${path.basename(progress.packageDir)}: Removed build output and cache.`;
  return formatGlyphLine(NMR_GLYPHS, style, 'clean', message);
}

// region | Helpers

/** Describes a sweep's outcome: the packages that it cleaned, and any that it left to an empty `clean` override. */
function describeSweep(cleanedCount: number, skippedCount: number): string {
  const packages = cleanedCount === 1 ? '1 package' : `${cleanedCount} packages`;
  const skipClause = skippedCount === 0 ? '' : `, skipping ${skippedCount} with an empty clean override`;

  return `Cleaned ${packages}${skipClause}.`;
}

// endregion | Helpers
