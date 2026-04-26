import { bold, dim, sectionHeader } from './format.ts';
import type { PrepareResult, ProjectPrepareResult, PropagationSource, WorkspacePrepareResult } from './types.ts';

/**
 * Format a `PrepareResult` into styled terminal output.
 *
 * Pure function: accepts structured data, returns a string. Never writes to stdout.
 * Single-workspace mode (no `name` field) renders flat output; multi-workspace mode
 * renders section headers per workspace, an optional project section, and a tag summary
 * at the end.
 */
export function reportPrepare(result: PrepareResult): string {
  const isMultiWorkspace = result.workspaces.some((w) => w.name !== undefined) || result.project !== undefined;

  if (isMultiWorkspace) {
    return formatMultiWorkspace(result);
  }

  return formatSingleWorkspace(result);
}

/** Format output for a single-package release. */
function formatSingleWorkspace(result: PrepareResult): string {
  const lines: string[] = [];
  const workspace = result.workspaces[0];

  if (workspace === undefined) {
    return '';
  }

  // Commits info
  const since = workspace.previousTag === undefined ? 'the beginning' : workspace.previousTag;
  lines.push(dim(`Found ${workspace.commitCount} commits since ${since}`));

  if (workspace.parsedCommitCount !== undefined) {
    lines.push(dim(`  Parsed ${workspace.parsedCommitCount} typed commits`));
  }

  formatUnparseableWarning(lines, workspace);

  if (workspace.status === 'skipped') {
    lines.push(`⏭️  ${workspace.skipReason ?? 'Skipped'}`);
    return lines.join('\n');
  }

  // --set-version: render an explicit version-override message instead of a bump label.
  if (workspace.setVersion !== undefined) {
    lines.push(`  Using version override: ${workspace.setVersion}`);
  } else if (workspace.parsedCommitCount === undefined && workspace.releaseType !== undefined) {
    // Bump override message (no parsedCommitCount means bump override was used)
    lines.push(`  Using bump override: ${workspace.releaseType}`);
  }

  // Bump info
  if (workspace.releaseType !== undefined) {
    lines.push(dim(`Bumping versions (${workspace.releaseType})...`));
  } else if (workspace.setVersion !== undefined) {
    lines.push(dim(`Bumping versions (version override)...`));
  }

  if (workspace.currentVersion !== undefined && workspace.newVersion !== undefined) {
    if (workspace.setVersion !== undefined) {
      lines.push(`📦 ${workspace.currentVersion} → ${bold(workspace.newVersion)} (version override)`);
    } else if (workspace.releaseType !== undefined) {
      lines.push(`📦 ${workspace.currentVersion} → ${bold(workspace.newVersion)} (${workspace.releaseType})`);
    }
  }

  // Bump file details
  formatBumpFiles(lines, workspace, result.dryRun);

  // Changelog info
  lines.push(dim('Generating changelogs...'));
  formatChangelogFiles(lines, workspace, result.dryRun);

  // Format command
  formatFormatCommand(lines, result);

  // Completion
  lines.push(`✅ Release preparation complete.`);
  if (workspace.tag !== undefined) {
    lines.push(`   🏷️  ${bold(workspace.tag)}`);
  }

  return lines.join('\n');
}

/** Format output for a monorepo release with multiple workspaces. */
function formatMultiWorkspace(result: PrepareResult): string {
  const lines: string[] = [];

  for (const workspace of result.workspaces) {
    formatWorkspaceSection(lines, workspace, result.dryRun);
  }

  if (result.project !== undefined) {
    formatProjectSection(lines, result.project, result.dryRun);
  }

  // Format command
  formatFormatCommand(lines, result);

  // Warnings
  formatWarnings(lines, result);

  // Tag summary
  if (result.tags.length > 0) {
    lines.push(`\n✅ Release preparation complete.`);
    for (const tag of result.tags) {
      lines.push(`   🏷️  ${bold(tag)}`);
    }
  } else {
    lines.push(`\n⏭️  No workspaces had release-worthy changes.`);
  }

  return lines.join('\n');
}

/**
 * Render the project release section using the same shape as a workspace section. The
 * project release always corresponds to a single bump (no propagation, no `--set-version`),
 * so the rendering branches are simpler than `formatWorkspaceSection`.
 */
function formatProjectSection(lines: string[], project: ProjectPrepareResult, dryRun: boolean): void {
  lines.push(`\n${sectionHeader('project')}`);

  const since = project.previousTag === undefined ? '(no previous release found)' : `since ${project.previousTag}`;
  lines.push(dim(`  Found ${project.commitCount} commits ${since}`));

  if (project.parsedCommitCount !== undefined) {
    lines.push(dim(`  Parsed ${project.parsedCommitCount} typed commits`));
  } else {
    lines.push(`  Using bump override: ${project.releaseType}`);
  }

  formatProjectUnparseable(lines, project);

  lines.push(
    dim(`  Bumping versions (${project.releaseType})...`),
    `  📦 ${project.currentVersion} → ${bold(project.newVersion)} (${project.releaseType})`,
  );

  for (const file of project.bumpedFiles) {
    if (dryRun) {
      lines.push(dim(`    [dry-run] Would bump ${file}`));
    } else {
      lines.push(dim(`    Bumped ${file}`));
    }
  }

  lines.push(dim('  Generating changelogs...'));
  for (const file of project.changelogFiles) {
    if (dryRun) {
      lines.push(dim(`    [dry-run] Would run: npx --yes git-cliff ... --output ${file}`));
    } else {
      lines.push(dim(`    Generating changelog: ${file}`));
    }
  }

  lines.push(`  🏷️  ${bold(project.tag)}`);
}

/** Append the unparseable-commit warning lines for a project release, if any. */
function formatProjectUnparseable(lines: string[], project: ProjectPrepareResult): void {
  const unparseable = project.unparseableCommits;
  if (unparseable === undefined || unparseable.length === 0) {
    return;
  }
  const count = unparseable.length;
  const isPatchFloor = project.parsedCommitCount === 0;
  const suffix = isPatchFloor ? ' (defaulting to patch bump)' : '';
  lines.push(`    ⚠️  ${count} commit${count === 1 ? '' : 's'} could not be parsed${suffix}`);
  for (const commit of unparseable) {
    const shortHash = commit.hash.slice(0, 7);
    const truncatedMessage = commit.message.length > 72 ? `${commit.message.slice(0, 69)}...` : commit.message;
    lines.push(`      · ${shortHash} ${truncatedMessage}`);
  }
}

/** Render a single workspace's section within multi-workspace output. */
function formatWorkspaceSection(lines: string[], workspace: WorkspacePrepareResult, dryRun: boolean): void {
  if (workspace.name !== undefined) {
    lines.push(`\n${sectionHeader(workspace.name)}`);
  }

  const since = workspace.previousTag === undefined ? '(no previous release found)' : `since ${workspace.previousTag}`;
  lines.push(dim(`  Found ${workspace.commitCount} commits ${since}`));

  if (workspace.status === 'skipped') {
    lines.push(`  ⏭️  ${workspace.skipReason ?? 'Skipped'}`);
    return;
  }

  const { propagatedFrom } = workspace;
  const isPropagatedOnly = propagatedFrom !== undefined && workspace.commitCount === 0;

  formatCommitSummary(lines, workspace, propagatedFrom, isPropagatedOnly);
  formatUnparseableWarning(lines, workspace, '  ');
  formatBumpLabels(lines, workspace, isPropagatedOnly);
  formatVersionLine(lines, workspace, propagatedFrom, isPropagatedOnly);

  formatBumpFiles(lines, workspace, dryRun, '  ');
  lines.push(dim('  Generating changelogs...'));
  formatChangelogFiles(lines, workspace, dryRun, '  ');

  if (workspace.tag !== undefined) {
    lines.push(`  🏷️  ${bold(workspace.tag)}`);
  }
}

/** Append the commit-count summary line for a workspace (propagation-only or parsed counts). */
function formatCommitSummary(
  lines: string[],
  workspace: WorkspacePrepareResult,
  propagatedFrom: PropagationSource[] | undefined,
  isPropagatedOnly: boolean,
): void {
  if (isPropagatedOnly && propagatedFrom !== undefined) {
    const depNames = propagatedFrom.map((p) => p.packageName).join(', ');
    lines.push(dim(`  0 commits (bumped via dependency: ${depNames})`));
  } else if (workspace.parsedCommitCount !== undefined) {
    lines.push(dim(`  Parsed ${workspace.parsedCommitCount} typed commits`));
  }
}

/** Append the bump-override / set-version label and the "Bumping versions..." line. */
function formatBumpLabels(lines: string[], workspace: WorkspacePrepareResult, isPropagatedOnly: boolean): void {
  if (workspace.setVersion !== undefined) {
    lines.push(`  Using version override: ${workspace.setVersion}`);
  } else if (workspace.parsedCommitCount === undefined && workspace.releaseType !== undefined && !isPropagatedOnly) {
    lines.push(`  Using bump override: ${workspace.releaseType}`);
  }

  if (workspace.releaseType !== undefined) {
    lines.push(dim(`  Bumping versions (${workspace.releaseType})...`));
  } else if (workspace.setVersion !== undefined) {
    lines.push(dim(`  Bumping versions (version override)...`));
  }
}

/** Append the `currentVersion → newVersion` line with the appropriate suffix. */
function formatVersionLine(
  lines: string[],
  workspace: WorkspacePrepareResult,
  propagatedFrom: PropagationSource[] | undefined,
  isPropagatedOnly: boolean,
): void {
  if (workspace.currentVersion === undefined || workspace.newVersion === undefined) {
    return;
  }

  if (workspace.setVersion !== undefined) {
    lines.push(`  📦 ${workspace.currentVersion} → ${bold(workspace.newVersion)} (version override)`);
  } else if (workspace.releaseType !== undefined) {
    const suffix = isPropagatedOnly ? formatPropagationSuffix(propagatedFrom) : '';
    lines.push(`  📦 ${workspace.currentVersion} → ${bold(workspace.newVersion)} (${workspace.releaseType}${suffix})`);
  }
}

/** Append bump file detail lines. */
function formatBumpFiles(lines: string[], workspace: WorkspacePrepareResult, dryRun: boolean, indent = ''): void {
  for (const file of workspace.bumpedFiles) {
    if (dryRun) {
      lines.push(dim(`${indent}  [dry-run] Would bump ${file}`));
    } else {
      lines.push(dim(`${indent}  Bumped ${file}`));
    }
  }
}

/** Append changelog file detail lines. */
function formatChangelogFiles(lines: string[], workspace: WorkspacePrepareResult, dryRun: boolean, indent = ''): void {
  for (const file of workspace.changelogFiles) {
    if (dryRun) {
      lines.push(dim(`${indent}  [dry-run] Would run: npx --yes git-cliff ... --output ${file}`));
    } else {
      lines.push(dim(`${indent}  Generating changelog: ${file}`));
    }
  }
}

/** Append unparseable commit warning lines when applicable. */
function formatUnparseableWarning(lines: string[], workspace: WorkspacePrepareResult, indent = ''): void {
  const unparseable = workspace.unparseableCommits;
  if (unparseable === undefined || unparseable.length === 0) {
    return;
  }

  const count = unparseable.length;
  const isPatchFloor = workspace.parsedCommitCount === 0;
  const suffix = isPatchFloor ? ' (defaulting to patch bump)' : '';
  lines.push(`${indent}  ⚠️  ${count} commit${count === 1 ? '' : 's'} could not be parsed${suffix}`);

  for (const commit of unparseable) {
    const shortHash = commit.hash.slice(0, 7);
    const truncatedMessage = commit.message.length > 72 ? `${commit.message.slice(0, 69)}...` : commit.message;
    lines.push(`${indent}    · ${shortHash} ${truncatedMessage}`);
  }
}

/** Format the propagation suffix for the version bump line (e.g., `, dependency: core`). */
function formatPropagationSuffix(propagatedFrom: PropagationSource[] | undefined): string {
  if (propagatedFrom === undefined || propagatedFrom.length === 0) {
    return '';
  }
  const names = propagatedFrom.map((p) => p.packageName).join(', ');
  return `, dependency: ${names}`;
}

/** Append warning lines when the prepare result includes warnings. */
function formatWarnings(lines: string[], result: PrepareResult): void {
  const { warnings } = result;
  if (warnings === undefined || warnings.length === 0) {
    return;
  }

  lines.push('');
  for (const warning of warnings) {
    lines.push(`⚠️  ${warning}`);
  }
}

/** Append format command lines. */
function formatFormatCommand(lines: string[], result: PrepareResult): void {
  if (result.formatCommand === undefined) {
    return;
  }

  if (result.formatCommand.executed) {
    lines.push(dim(`\n  Running format command: ${result.formatCommand.command}`));
  } else {
    lines.push(dim(`\n  [dry-run] Would run format command: ${result.formatCommand.command}`));
  }
}
