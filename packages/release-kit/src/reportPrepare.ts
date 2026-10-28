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
import type {
  CompositePrepareResult,
  DirectoryPrepareResult,
  PackagePrepareResult,
  PrepareResult,
  PropagationSource,
  ReleasedDirectoryResult,
  ReleasedPackageResult,
} from './types.ts';

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

  const sinceLabel = workspace.previousTag === undefined ? 'the beginning' : workspace.previousTag;
  lines.push(dim(`Found ${workspace.commitCount} commits since ${sinceLabel}`));

  if (workspace.parsedCommitCount !== undefined) {
    lines.push(dim(`  Parsed ${workspace.parsedCommitCount} typed commits`));
  }

  formatUnparseableWarning(lines, workspace, style);
  formatPolicyViolations(lines, workspace.policyViolations, style);

  if (workspace.status === 'skipped') {
    formatChangeRecordWarnings(lines, workspace, style);
    lines.push(formatStatusLine(style, 'skipped', workspace.skipReason));
    formatWarnings(lines, result, style);
    return lines.join('\n');
  }

  if (workspace.versionOverride !== undefined) {
    lines.push(`  Using version override: ${workspace.versionOverride}`);
  } else if (workspace.bumpOverride !== undefined) {
    lines.push(`  Using bump override: ${workspace.bumpOverride}`);
  }

  if (workspace.releaseType !== undefined) {
    lines.push(dim(`Bumping versions (${workspace.releaseType})...`));
  } else if (workspace.versionOverride !== undefined) {
    lines.push(dim(`Bumping versions (version override)...`));
  }

  if (workspace.versionOverride !== undefined) {
    lines.push(
      formatGlyphLine(
        RELEASE_GLYPHS,
        style,
        'bump',
        `${workspace.currentVersion} → ${bold(workspace.newVersion)} (version override)`,
      ),
    );
  } else if (workspace.releaseType !== undefined) {
    lines.push(
      formatGlyphLine(
        RELEASE_GLYPHS,
        style,
        'bump',
        `${workspace.currentVersion} → ${bold(workspace.newVersion)} (${workspace.releaseType})`,
      ),
    );
  }

  formatChangeRecordWarnings(lines, workspace, style);

  formatBumpFiles(lines, workspace, isDryRun);

  lines.push(dim('Generating changelogs...'));
  formatChangelogFiles(lines, workspace, isDryRun, style);
  formatPreviewFiles(lines, workspace, isDryRun);

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
    if (target.kind === 'composite') {
      formatProjectSection(lines, target, isDryRun, style);
    } else {
      formatWorkspaceSection(lines, target, isDryRun, style);
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

/**
 * Renders a composite's release section in the shape of a workspace section, headed by its name, or by `project` for a
 * `project` block's composite. A project release is neither propagated nor
 * set by `--set-version`, so only its bump override and release type label the bump.
 */
function formatProjectSection(
  lines: string[],
  project: CompositePrepareResult,
  isDryRun: boolean,
  style: OutputStyle,
): void {
  lines.push(`\n${renderSectionHeader(project.targetId === PROJECT_TARGET_ID ? 'project' : project.targetId)}`);

  const sinceLabel = project.previousTag === undefined ? '(no previous release found)' : `since ${project.previousTag}`;
  lines.push(dim(`  Found ${project.commitCount} commits ${sinceLabel}`));

  formatPolicyViolations(lines, project.policyViolations, style, '  ');

  if (project.status === 'skipped') {
    formatUnparseableWarning(lines, project, style, '  ');
    formatChangeRecordWarnings(lines, project, style, '  ');
    lines.push(`  ${formatStatusLine(style, 'skipped', project.skipReason)}`);
    return;
  }

  const { releaseType, currentVersion, newVersion, tag } = project;

  // Suppress "Parsed 0 typed commits", which says nothing about a forced release without a
  // parsed commit.
  if (project.parsedCommitCount > 0) {
    lines.push(dim(`  Parsed ${project.parsedCommitCount} typed commits`));
  }
  if (project.bumpOverride !== undefined) {
    lines.push(`  Using bump override: ${project.bumpOverride}`);
  }

  formatUnparseableWarning(lines, project, style, '  ');
  formatChangeRecordWarnings(lines, project, style, '  ');

  lines.push(
    dim(`  Bumping versions (${releaseType})...`),
    `  ${formatGlyphLine(RELEASE_GLYPHS, style, 'bump', `${currentVersion} → ${bold(newVersion)} (${releaseType})`)}`,
  );

  for (const file of project.bumpedFiles) {
    if (isDryRun) {
      lines.push(dim(`    [dry-run] Would bump ${file}`));
    } else {
      lines.push(dim(`    Bumped ${file}`));
    }
  }

  lines.push(dim('  Generating changelogs...'));
  formatChangelogFiles(lines, project, isDryRun, style, '  ');
  formatPreviewFiles(lines, project, isDryRun, '  ');

  lines.push(`  ${formatGlyphLine(RELEASE_GLYPHS, style, 'tag', bold(tag))}`);
}

/** A released package or directory result, which the workspace section renders. */
type ReleasedMemberResult = ReleasedPackageResult | ReleasedDirectoryResult;

/** Renders a workspace's or a directory's section within multi-workspace output. */
function formatWorkspaceSection(
  lines: string[],
  workspace: PackagePrepareResult | DirectoryPrepareResult,
  isDryRun: boolean,
  style: OutputStyle,
): void {
  if (workspace.name !== undefined) {
    lines.push(`\n${renderSectionHeader(workspace.name)}`);
  }

  const sinceLabel =
    workspace.previousTag === undefined ? '(no previous release found)' : `since ${workspace.previousTag}`;
  lines.push(dim(`  Found ${workspace.commitCount} commits ${sinceLabel}`));

  if (workspace.status === 'skipped') {
    formatUnparseableWarning(lines, workspace, style, '  ');
    formatPolicyViolations(lines, workspace.policyViolations, style, '  ');
    formatChangeRecordWarnings(lines, workspace, style, '  ');
    lines.push(`  ${formatStatusLine(style, 'skipped', workspace.skipReason)}`);
    return;
  }

  const propagatedFrom = workspace.kind === 'package' ? workspace.propagatedFrom : undefined;
  const isPropagatedOnly = workspace.kind === 'package' && workspace.propagatedOnly === true;

  formatCommitSummary(lines, workspace, propagatedFrom, isPropagatedOnly);
  formatUnparseableWarning(lines, workspace, style, '  ');
  formatPolicyViolations(lines, workspace.policyViolations, style, '  ');
  formatChangeRecordWarnings(lines, workspace, style, '  ');
  formatBumpLabels(lines, workspace, isPropagatedOnly);
  formatVersionLine(lines, workspace, propagatedFrom, isPropagatedOnly, style);

  formatBumpFiles(lines, workspace, isDryRun, '  ');
  lines.push(dim('  Generating changelogs...'));
  formatChangelogFiles(lines, workspace, isDryRun, style, '  ');
  formatPreviewFiles(lines, workspace, isDryRun, '  ');

  lines.push(`  ${formatGlyphLine(RELEASE_GLYPHS, style, 'tag', bold(workspace.tag))}`);
}

/** Appends the line under the commit count: the dependencies behind a propagation-only bump, or the parsed count. */
function formatCommitSummary(
  lines: string[],
  workspace: ReleasedMemberResult,
  propagatedFrom: PropagationSource[] | undefined,
  isPropagatedOnly: boolean,
): void {
  if (isPropagatedOnly && propagatedFrom !== undefined) {
    const depNames = propagatedFrom.map((p) => p.packageName).join(', ');
    lines.push(dim(`  Bumped via dependency: ${depNames}`));
  } else if (workspace.parsedCommitCount !== undefined && workspace.parsedCommitCount > 0) {
    // Suppress "Parsed 0 typed commits", which says nothing about a forced release without a
    // parsed commit.
    lines.push(dim(`  Parsed ${workspace.parsedCommitCount} typed commits`));
  }
}

/** Appends the bump-override / set-version label and the "Bumping versions..." line. */
function formatBumpLabels(lines: string[], workspace: ReleasedMemberResult, isPropagatedOnly: boolean): void {
  if (workspace.versionOverride !== undefined) {
    lines.push(`  Using version override: ${workspace.versionOverride}`);
  } else if (workspace.bumpOverride !== undefined && !isPropagatedOnly) {
    lines.push(`  Using bump override: ${workspace.bumpOverride}`);
  }

  if (workspace.releaseType !== undefined) {
    lines.push(dim(`  Bumping versions (${workspace.releaseType})...`));
  } else if (workspace.versionOverride !== undefined) {
    lines.push(dim(`  Bumping versions (version override)...`));
  }
}

/** Appends the `currentVersion → newVersion` line with the appropriate suffix. */
function formatVersionLine(
  lines: string[],
  workspace: ReleasedMemberResult,
  propagatedFrom: PropagationSource[] | undefined,
  isPropagatedOnly: boolean,
  style: OutputStyle,
): void {
  const versions = `${workspace.currentVersion} → ${bold(workspace.newVersion)}`;
  if (workspace.versionOverride !== undefined) {
    lines.push(`  ${formatGlyphLine(RELEASE_GLYPHS, style, 'bump', `${versions} (version override)`)}`);
  } else if (workspace.releaseType !== undefined) {
    const suffix = isPropagatedOnly ? formatPropagationSuffix(propagatedFrom) : '';
    lines.push(
      `  ${formatGlyphLine(RELEASE_GLYPHS, style, 'bump', `${versions} (${workspace.releaseType}${suffix})`)}`,
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
