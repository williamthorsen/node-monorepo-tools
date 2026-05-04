import { bold, dim, sectionHeader } from './format.ts';
import type {
  PolicyViolation,
  PrepareResult,
  ProjectPrepareResult,
  PropagationSource,
  ReleasedProjectResult,
  ReleasedWorkspaceResult,
  WorkspacePrepareResult,
} from './types.ts';

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
  formatPolicyViolations(lines, workspace.policyViolations);

  if (workspace.status === 'skipped') {
    lines.push(`⏭️  ${workspace.skipReason}`);
    return lines.join('\n');
  }

  // --set-version: render an explicit version-override message instead of a bump label.
  if (workspace.setVersion !== undefined) {
    lines.push(`  Using version override: ${workspace.setVersion}`);
  } else if (workspace.bumpOverride !== undefined) {
    lines.push(`  Using bump override: ${workspace.bumpOverride}`);
  }

  // Bump info
  if (workspace.releaseType !== undefined) {
    lines.push(dim(`Bumping versions (${workspace.releaseType})...`));
  } else if (workspace.setVersion !== undefined) {
    lines.push(dim(`Bumping versions (version override)...`));
  }

  if (workspace.setVersion !== undefined) {
    lines.push(`📦 ${workspace.currentVersion} → ${bold(workspace.newVersion)} (version override)`);
  } else if (workspace.releaseType !== undefined) {
    lines.push(`📦 ${workspace.currentVersion} → ${bold(workspace.newVersion)} (${workspace.releaseType})`);
  }

  // Bump file details
  formatBumpFiles(lines, workspace, result.dryRun);

  // Changelog info
  lines.push(dim('Generating changelogs...'));
  formatChangelogFiles(lines, workspace, result.dryRun);

  // Format command
  formatFormatCommand(lines, result);

  // Completion
  lines.push(`✅ Release preparation complete.`, `   🏷️  ${bold(workspace.tag)}`);

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
 *
 * For skipped projects, mirrors `formatWorkspaceSection`'s skipped rendering: section
 * header, "Found N commits …" line, and the skip reason — then returns early. The
 * `parsedCommitCount` and `unparseableCommits` diagnostic data remains on the
 * structured `ProjectPrepareResult` returned to programmatic callers; it is
 * intentionally suppressed in the terminal rendering for symmetry with the existing
 * skipped workspace rendering.
 */
function formatProjectSection(lines: string[], project: ProjectPrepareResult, dryRun: boolean): void {
  lines.push(`\n${sectionHeader('project')}`);

  const since = project.previousTag === undefined ? '(no previous release found)' : `since ${project.previousTag}`;
  lines.push(dim(`  Found ${project.commitCount} commits ${since}`));

  formatPolicyViolations(lines, project.policyViolations, '  ');

  if (project.status === 'skipped') {
    lines.push(`  ⏭️  ${project.skipReason}`);
    return;
  }

  // Released variant: release-only fields are populated.
  const { releaseType, currentVersion, newVersion, tag } = project;

  // Suppress "Parsed 0 typed commits" — uninformative under the unified algorithm where
  // `parsedCommitCount` is always populated (e.g., 0 for `--force` alone with no commits).
  if (project.parsedCommitCount > 0) {
    lines.push(dim(`  Parsed ${project.parsedCommitCount} typed commits`));
  }
  if (project.bumpOverride !== undefined) {
    lines.push(`  Using bump override: ${project.bumpOverride}`);
  }

  formatProjectUnparseable(lines, project);

  lines.push(
    dim(`  Bumping versions (${releaseType})...`),
    `  📦 ${currentVersion} → ${bold(newVersion)} (${releaseType})`,
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

  lines.push(`  🏷️  ${bold(tag)}`);
}

/** Append the unparseable-commit warning lines for a project release, if any. */
function formatProjectUnparseable(lines: string[], project: ReleasedProjectResult): void {
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
    lines.push(`  ⏭️  ${workspace.skipReason}`);
    return;
  }

  const { propagatedFrom } = workspace;
  const isPropagatedOnly = propagatedFrom !== undefined && workspace.commitCount === 0;

  formatCommitSummary(lines, workspace, propagatedFrom, isPropagatedOnly);
  formatUnparseableWarning(lines, workspace, '  ');
  formatPolicyViolations(lines, workspace.policyViolations, '  ');
  formatBumpLabels(lines, workspace, isPropagatedOnly);
  formatVersionLine(lines, workspace, propagatedFrom, isPropagatedOnly);

  formatBumpFiles(lines, workspace, dryRun, '  ');
  lines.push(dim('  Generating changelogs...'));
  formatChangelogFiles(lines, workspace, dryRun, '  ');

  lines.push(`  🏷️  ${bold(workspace.tag)}`);
}

/** Append the commit-count summary line for a workspace (propagation-only or parsed counts). */
function formatCommitSummary(
  lines: string[],
  workspace: ReleasedWorkspaceResult,
  propagatedFrom: PropagationSource[] | undefined,
  isPropagatedOnly: boolean,
): void {
  if (isPropagatedOnly && propagatedFrom !== undefined) {
    const depNames = propagatedFrom.map((p) => p.packageName).join(', ');
    lines.push(dim(`  0 commits (bumped via dependency: ${depNames})`));
  } else if (workspace.parsedCommitCount !== undefined && workspace.parsedCommitCount > 0) {
    // Suppress "Parsed 0 typed commits" for `--force`-alone-with-no-commits cases where
    // the unified algorithm now populates parsedCommitCount as 0 deterministically.
    lines.push(dim(`  Parsed ${workspace.parsedCommitCount} typed commits`));
  }
}

/** Append the bump-override / set-version label and the "Bumping versions..." line. */
function formatBumpLabels(lines: string[], workspace: ReleasedWorkspaceResult, isPropagatedOnly: boolean): void {
  if (workspace.setVersion !== undefined) {
    lines.push(`  Using version override: ${workspace.setVersion}`);
  } else if (workspace.bumpOverride !== undefined && !isPropagatedOnly) {
    lines.push(`  Using bump override: ${workspace.bumpOverride}`);
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
  workspace: ReleasedWorkspaceResult,
  propagatedFrom: PropagationSource[] | undefined,
  isPropagatedOnly: boolean,
): void {
  if (workspace.setVersion !== undefined) {
    lines.push(`  📦 ${workspace.currentVersion} → ${bold(workspace.newVersion)} (version override)`);
  } else if (workspace.releaseType !== undefined) {
    const suffix = isPropagatedOnly ? formatPropagationSuffix(propagatedFrom) : '';
    lines.push(`  📦 ${workspace.currentVersion} → ${bold(workspace.newVersion)} (${workspace.releaseType}${suffix})`);
  }
}

/** Append bump file detail lines. */
function formatBumpFiles(lines: string[], workspace: ReleasedWorkspaceResult, dryRun: boolean, indent = ''): void {
  for (const file of workspace.bumpedFiles) {
    if (dryRun) {
      lines.push(dim(`${indent}  [dry-run] Would bump ${file}`));
    } else {
      lines.push(dim(`${indent}  Bumped ${file}`));
    }
  }
}

/** Append changelog file detail lines. */
function formatChangelogFiles(lines: string[], workspace: ReleasedWorkspaceResult, dryRun: boolean, indent = ''): void {
  for (const file of workspace.changelogFiles) {
    if (dryRun) {
      lines.push(dim(`${indent}  [dry-run] Would run: npx --yes git-cliff ... --output ${file}`));
    } else {
      lines.push(dim(`${indent}  Generating changelog: ${file}`));
    }
  }
}

/**
 * Append unparseable commit warning lines when applicable.
 *
 * `indent` is an additional outer indent prepended to both the header and bullet lines; base
 * spacing (2 spaces for the header, 4 for bullets) is encoded in the format strings, so the
 * caller passes only the section-level indent (e.g., `''` for single-package, `'  '` for
 * multi-workspace).
 */
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

/**
 * Append policy-violation lines when applicable.
 *
 * Renders one header line plus one bullet per violation. Subject truncation matches
 * `formatUnparseableWarning`'s 72-char convention. Returns early when no violations
 * were collected, leaving the lines array unchanged.
 *
 * `indent` is an additional outer indent prepended to both the header and bullet lines; base
 * spacing (2 spaces for the header, 4 for bullets) is encoded in the format strings, so the
 * caller passes only the section-level indent (e.g., `''` for single-package, `'  '` for
 * multi-workspace).
 */
function formatPolicyViolations(lines: string[], violations: PolicyViolation[] | undefined, indent = ''): void {
  if (violations === undefined || violations.length === 0) {
    return;
  }

  const count = violations.length;
  lines.push(`${indent}  ⚠️  ${count} policy violation${count === 1 ? '' : 's'}:`);
  for (const violation of violations) {
    const shortHash = violation.commitHash.slice(0, 7);
    const subject = violation.commitSubject;
    const truncatedSubject = subject.length > 72 ? `${subject.slice(0, 69)}...` : subject;
    lines.push(
      `${indent}    · ${shortHash} '${truncatedSubject}' — type '${violation.type}' at ${violation.surface} surface`,
    );
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
