import {
  formatGlyphLine,
  formatStatusLine,
  measureGlyphColumn,
  type OutputStyle,
  STATUS_GLYPHS,
} from '@williamthorsen/nmr-core';

import { bold, dim, renderSectionHeader } from './format.ts';
import { formatBumpFiles, formatChangelogFiles, formatPreviewFiles } from './formatPrepareFiles.ts';
import {
  formatChangeRecordWarnings,
  formatPolicyViolations,
  formatUnparseableWarning,
  formatWarnings,
} from './formatPrepareWarnings.ts';
import { RELEASE_GLYPHS } from './glyphs.ts';
import { PROJECT_TARGET_ID } from './resolveReleaseTargets.ts';
import type { PrepareResult, PropagationSource, ReleasedTargetResult, TargetPrepareResult } from './types.ts';

/** How the plan was carried out, which decides the report's tense. */
export interface ReportPrepareOptions {
  /** True when the plan was written to disk; false for a dry run. */
  applied: boolean;
  /** The format command's failure message, when it ran and failed. */
  formatError?: string;
  style: OutputStyle;
}

/**
 * Formats a release plan into styled terminal output, without writing it.
 *
 * A plan whose package results lack a `name` and that lacks a composite result renders flat output, as a
 * single-package release does; any other plan renders a section per target and a tag summary at the end.
 *
 * Whether the plan was applied is a property of the render, not of the plan: The same plan
 * produces the dry-run report and the applied report.
 */
export function reportPrepare(plan: PrepareResult, options: ReportPrepareOptions): string {
  const isMultiWorkspace = plan.targets.some((target) => target.kind === 'composite' || target.name !== undefined);

  if (isMultiWorkspace) {
    return formatMultiWorkspace(plan, options);
  }

  return formatSingleWorkspace(plan, options);
}

/** Formats output for a single-package release. */
function formatSingleWorkspace(result: PrepareResult, options: ReportPrepareOptions): string {
  const isDryRun = !options.applied;
  const { style } = options;
  const lines: string[] = [];
  const workspace = result.targets[0];

  if (workspace === undefined || workspace.kind === 'composite') {
    return '';
  }

  const sinceLabel = `since ${workspace.previousTag ?? 'the beginning'}`;
  formatTargetSection(lines, workspace, { indent: '', sinceLabel }, isDryRun, style);

  if (workspace.status === 'skipped') {
    formatWarnings(lines, result, style);
    return lines.join('\n');
  }

  formatFormatCommand(lines, result, options);

  formatWarnings(lines, result, style);

  lines.push(
    formatStatusLine(style, 'passed', 'Release preparation complete.'),
    `   ${formatGlyphLine(RELEASE_GLYPHS, style, 'tag', bold(workspace.tag))}`,
  );

  return lines.join('\n');
}

/** Formats output for a monorepo release with multiple workspaces. */
function formatMultiWorkspace(result: PrepareResult, options: ReportPrepareOptions): string {
  const isDryRun = !options.applied;
  const { style } = options;
  const lines: string[] = [];

  for (const target of result.targets) {
    const title = getSectionTitle(target);
    if (title !== undefined) {
      lines.push(`\n${renderSectionHeader(title)}`);
    }

    const sinceLabel = target.previousTag === undefined ? '(no previous release found)' : `since ${target.previousTag}`;
    formatTargetSection(lines, target, { indent: '  ', sinceLabel }, isDryRun, style);

    if (target.status === 'released') {
      lines.push(`  ${formatGlyphLine(RELEASE_GLYPHS, style, 'tag', bold(target.tag))}`);
    }
  }

  formatFormatCommand(lines, result, options);

  formatWarnings(lines, result, style);

  if (result.tags.length > 0) {
    lines.push(`\n${formatStatusLine(style, 'passed', 'Release preparation complete.')}`);
    for (const tag of result.tags) {
      lines.push(`   ${formatGlyphLine(RELEASE_GLYPHS, style, 'tag', bold(tag))}`);
    }
  } else {
    lines.push(
      `\n${formatStatusLine(style, 'skipped', 'The run did not find release-worthy changes in any workspace.')}`,
    );
  }

  return lines.join('\n');
}

/** Returns a section's title: `project` for a `project` block's composite, else the target's name, if it has one. */
function getSectionTitle(target: TargetPrepareResult): string | undefined {
  if (target.kind === 'composite') {
    return target.targetId === PROJECT_TARGET_ID ? 'project' : target.targetId;
  }
  return target.name;
}

/** Where a section sits in the report and how it names the previous release. */
interface SectionLayout {
  /** The section-level indent, which the warning and file helpers take as their `indent`. */
  indent: string;
  /** The text after the commit count. */
  sinceLabel: string;
}

/**
 * Renders a target's section from the commit count through the release's files, in one order for every kind; the
 * header and the tag line belong to the caller.
 */
function formatTargetSection(
  lines: string[],
  target: TargetPrepareResult,
  layout: SectionLayout,
  isDryRun: boolean,
  style: OutputStyle,
): void {
  const { indent, sinceLabel } = layout;
  lines.push(dim(`${indent}Found ${target.commitCount} commits ${sinceLabel}`));

  if (target.status === 'skipped') {
    formatTargetWarnings(lines, target, style, indent);
    lines.push(`${indent}${formatStatusLine(style, 'skipped', target.skipReason)}`);
    return;
  }

  const origin = describeBumpOrigin(target);
  formatCommitSummary(lines, target, origin);
  formatTargetWarnings(lines, target, style, indent);
  formatBumpLabels(lines, target, origin, indent);
  formatVersionLine(lines, target, origin, indent, style);

  formatBumpFiles(lines, target, isDryRun, indent);
  lines.push(dim(`${indent}Generating changelogs...`));
  formatChangelogFiles(lines, target, isDryRun, style, indent);
  formatPreviewFiles(lines, target, isDryRun, indent);
}

/** Appends the unparseable-commit, policy-violation, and change-record warnings. */
function formatTargetWarnings(lines: string[], target: TargetPrepareResult, style: OutputStyle, indent: string): void {
  formatUnparseableWarning(lines, target, style, indent);
  formatPolicyViolations(lines, target.policyViolations, style, indent);
  formatChangeRecordWarnings(lines, target, style, indent);
}

/** What set a released target's version besides its own commits. */
interface BumpOrigin {
  /** The dependencies whose bump propagated to the target. */
  propagatedFrom: PropagationSource[] | undefined;
  /** True when propagation alone set the bump. */
  isPropagatedOnly: boolean;
  /** The version that `--set-version` applied. */
  versionOverride: string | undefined;
}

/** Reads a released target's propagation and version override; a composite takes neither. */
function describeBumpOrigin(target: ReleasedTargetResult): BumpOrigin {
  if (target.kind === 'composite') {
    return { propagatedFrom: undefined, isPropagatedOnly: false, versionOverride: undefined };
  }
  if (target.kind === 'directory') {
    return { propagatedFrom: undefined, isPropagatedOnly: false, versionOverride: target.versionOverride };
  }
  return {
    propagatedFrom: target.propagatedFrom,
    isPropagatedOnly: target.propagatedOnly === true,
    versionOverride: target.versionOverride,
  };
}

/**
 * Appends the line under the commit count: the dependencies behind a propagation-only bump, or the parsed count. The
 * line sits two columns in whatever the section's indent.
 */
function formatCommitSummary(lines: string[], target: ReleasedTargetResult, origin: BumpOrigin): void {
  if (origin.isPropagatedOnly && origin.propagatedFrom !== undefined) {
    const dependencyNames = origin.propagatedFrom.map((p) => p.packageName).join(', ');
    lines.push(dim(`  Bumped via dependency: ${dependencyNames}`));
  } else if (target.parsedCommitCount !== undefined && target.parsedCommitCount > 0) {
    // Suppress "Parsed 0 typed commits", which says nothing about a forced release without a
    // parsed commit.
    lines.push(dim(`  Parsed ${target.parsedCommitCount} typed commits`));
  }
}

/**
 * Appends the bump-override / set-version label, which sits two columns in whatever the section's indent, and the
 * "Bumping versions..." line.
 */
function formatBumpLabels(lines: string[], target: ReleasedTargetResult, origin: BumpOrigin, indent: string): void {
  if (origin.versionOverride !== undefined) {
    lines.push(`  Using version override: ${origin.versionOverride}`);
  } else if (target.bumpOverride !== undefined && !origin.isPropagatedOnly) {
    lines.push(`  Using bump override: ${target.bumpOverride}`);
  }

  if (target.releaseType !== undefined) {
    lines.push(dim(`${indent}Bumping versions (${target.releaseType})...`));
  } else if (origin.versionOverride !== undefined) {
    lines.push(dim(`${indent}Bumping versions (version override)...`));
  }
}

/** Appends the `currentVersion → newVersion` line with the appropriate suffix. */
function formatVersionLine(
  lines: string[],
  target: ReleasedTargetResult,
  origin: BumpOrigin,
  indent: string,
  style: OutputStyle,
): void {
  const versions = `${target.currentVersion} → ${bold(target.newVersion)}`;
  if (origin.versionOverride !== undefined) {
    lines.push(`${indent}${formatGlyphLine(RELEASE_GLYPHS, style, 'bump', `${versions} (version override)`)}`);
  } else if (target.releaseType !== undefined) {
    const suffix = origin.isPropagatedOnly ? formatPropagationSuffix(origin.propagatedFrom) : '';
    lines.push(
      `${indent}${formatGlyphLine(RELEASE_GLYPHS, style, 'bump', `${versions} (${target.releaseType}${suffix})`)}`,
    );
  }
}

/** Formats the propagation suffix for the version bump line (e.g., `, dependency: core`). */
function formatPropagationSuffix(propagatedFrom: PropagationSource[] | undefined): string {
  if (propagatedFrom === undefined || propagatedFrom.length === 0) {
    return '';
  }
  const names = propagatedFrom.map((p) => p.packageName).join(', ');
  return `, dependency: ${names}`;
}

/** Appends format command lines. */
function formatFormatCommand(lines: string[], result: PrepareResult, options: ReportPrepareOptions): void {
  if (result.formatCommand === undefined) {
    return;
  }

  if (!options.applied) {
    lines.push(dim(`\n  [dry-run] Would run format command: ${result.formatCommand.command}`));
    return;
  }

  if (options.formatError === undefined) {
    lines.push(dim(`\n  Running format command: ${result.formatCommand.command}`));
    return;
  }

  // Indent the failure message to the column at which the status line's message starts.
  const messageIndent = ' '.repeat(2 + measureGlyphColumn(STATUS_GLYPHS[options.style]) + 1);
  lines.push(
    `\n  ${formatStatusLine(options.style, 'warning', `Format command failed: ${result.formatCommand.command}`)}`,
    `${messageIndent}${options.formatError}`,
  );
}
