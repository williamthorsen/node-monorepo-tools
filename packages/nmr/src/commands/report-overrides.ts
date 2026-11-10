import process from 'node:process';

import { formatGlyphLine, type OutputStyle, UserError } from '@williamthorsen/nmr-core';
import { defineCommand, runCli } from '@williamthorsen/nmr-core/cli';

import { NMR_REPORT_OVERRIDES_BIN } from '../bins.ts';

import { NMR_GLYPHS } from '../glyphs.ts';
import { getPnpmOverrides, readPackageJson } from '../helpers/package-json.ts';
import { reportClosing } from '../helpers/reportClosing.ts';
import { resolveBinStyles } from '../resolveBinStyles.ts';
import { findMonorepoRoot, readWorkspaceOverrides } from '../workspace.ts';

/**
 * Runs `nmr-report-overrides` against `argv` for the monorepo containing `cwd` and returns the exit code to report.
 * The command takes neither an option nor an operand, so anything but `--help` is a usage error and reports nothing.
 */
export async function runReportOverrides(argv: string[], cwd: string): Promise<number> {
  const command = defineCommand({
    summary: 'Report the pnpm overrides that the monorepo declares',
    run: () => {
      // The report goes to stderr, so it takes that stream's style.
      reportOverrides(findMonorepoRoot(cwd), resolveBinStyles().stderr);
      return 0;
    },
  });

  return runCli(argv, command, {
    name: NMR_REPORT_OVERRIDES_BIN,
    stdout: process.stdout,
    stderr: process.stderr,
    baseDir: cwd,
  });
}

/**
 * Reports the pnpm dependency overrides declared in the monorepo root's `pnpm-workspace.yaml`, and rejects a
 * `pnpm.overrides` block left behind in the root `package.json`.
 */
export function reportOverrides(monorepoRoot: string, style: OutputStyle): void {
  const declaredOverrides = listEntries(readWorkspaceOverrides(monorepoRoot));

  if (declaredOverrides.length > 0) {
    console.warn(formatGlyphLine(NMR_GLYPHS, style, 'overrides', 'WARN: pnpm overrides are active:'));
    for (const [name, version] of declaredOverrides) {
      console.warn(`- ${name} → ${version}`);
    }
    reportClosing(
      formatGlyphLine(NMR_GLYPHS, style, 'overrides', describeOverrides(declaredOverrides.length)),
      console.warn,
    );
  }

  rejectLegacyOverrides(monorepoRoot);
}

// region | Helpers

/** Describes the report's outcome: how many overrides are declared, and the follow-up that they need. */
function describeOverrides(count: number): string {
  return count === 1
    ? '1 override is active. Check whether it is still needed.'
    : `${count} overrides are active. Check whether they are still needed.`;
}

/** Returns a record's entries ordered by key. */
function listEntries<T>(overrides: Record<string, T> | undefined): [string, T][] {
  return Object.entries(overrides ?? {}).toSorted(([a], [b]) => a.localeCompare(b));
}

/**
 * Rejects a `pnpm.overrides` block in the root `package.json`, naming every entry that it contains.
 *
 * pnpm 11 does not read any setting from that field, so the block pins nothing -- while the upgrade tool, which
 * keeps its own list of dependency fields, goes on rewriting the versions in it under `--write`. That leaves a
 * block looking maintained while it governs nothing, and failing here keeps the write from happening.
 */
function rejectLegacyOverrides(monorepoRoot: string): void {
  const legacyOverrides = listEntries(getPnpmOverrides(readPackageJson(monorepoRoot)));

  if (legacyOverrides.length === 0) {
    return;
  }

  throw new UserError(
    [
      'pnpm 11 does not read `pnpm.overrides` from package.json, so these pin nothing while an upgrade run with `--write` goes on rewriting them:',
      ...legacyOverrides.map(([name, version]) => `- ${name} → ${String(version)}`),
      'Move them to the `overrides` block in pnpm-workspace.yaml, quoting each version, or run `pnpx codemod run pnpm-v10-to-v11`.',
    ].join('\n'),
  );
}

// endregion | Helpers
