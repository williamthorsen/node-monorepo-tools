import { bold, dim, sectionHeader } from './format.ts';
import type { ComponentPrepareResult, PrepareResult } from './types.ts';

/**
 * Format a `PrepareResult` into styled terminal output.
 *
 * Pure function: accepts structured data, returns a string. Never writes to stdout.
 * Single-component mode (no `name` field) renders flat output; multi-component mode
 * renders section headers per component and a tag summary at the end.
 */
export function reportPrepare(result: PrepareResult): string {
  const isMultiComponent = result.components.some((c) => c.name !== undefined);

  if (isMultiComponent) {
    return formatMultiComponent(result);
  }

  return formatSingleComponent(result);
}

/** Format output for a single-package release. */
function formatSingleComponent(result: PrepareResult): string {
  const lines: string[] = [];
  const component = result.components[0];

  if (component === undefined) {
    return '';
  }

  // Commits info
  const since = component.previousTag === undefined ? 'the beginning' : component.previousTag;
  lines.push(dim(`Found ${component.commitCount} commits since ${since}`));

  if (component.parsedCommitCount !== undefined) {
    lines.push(dim(`  Parsed ${component.parsedCommitCount} typed commits`));
  }

  if (component.status === 'skipped') {
    lines.push(`⏭️  ${component.skipReason ?? 'Skipped'}`);
    return lines.join('\n');
  }

  // Bump override message (no parsedCommitCount means bump override was used)
  if (component.parsedCommitCount === undefined && component.releaseType !== undefined) {
    lines.push(`  Using bump override: ${component.releaseType}`);
  }

  // Bump info
  if (component.releaseType !== undefined) {
    lines.push(dim(`Bumping versions (${component.releaseType})...`));
  }

  if (
    component.currentVersion !== undefined &&
    component.newVersion !== undefined &&
    component.releaseType !== undefined
  ) {
    lines.push(`📦 ${component.currentVersion} → ${bold(component.newVersion)} (${component.releaseType})`);
  }

  // Bump file details
  formatBumpFiles(lines, component, result.dryRun);

  // Changelog info
  lines.push(dim('Generating changelogs...'));
  formatChangelogFiles(lines, component, result.dryRun);

  // Format command
  formatFormatCommand(lines, result);

  // Completion
  lines.push(`✅ Release preparation complete.`);
  if (component.tag !== undefined) {
    lines.push(`   🏷️  ${bold(component.tag)}`);
  }

  return lines.join('\n');
}

/** Format output for a monorepo release with multiple components. */
function formatMultiComponent(result: PrepareResult): string {
  const lines: string[] = [];

  for (const component of result.components) {
    if (component.name !== undefined) {
      lines.push(`\n${sectionHeader(component.name)}`);
    }

    const since = formatSince(component);

    lines.push(dim(`  Found ${component.commitCount} commits ${since}`));

    if (component.status === 'skipped') {
      lines.push(`  ⏭️  ${component.skipReason ?? 'Skipped'}`);
      continue;
    }

    if (component.parsedCommitCount !== undefined) {
      lines.push(dim(`  Parsed ${component.parsedCommitCount} typed commits`));
    }

    if (component.parsedCommitCount === undefined && component.releaseType !== undefined) {
      lines.push(`  Using bump override: ${component.releaseType}`);
    }

    if (component.releaseType !== undefined) {
      lines.push(dim(`  Bumping versions (${component.releaseType})...`));
    }

    if (
      component.currentVersion !== undefined &&
      component.newVersion !== undefined &&
      component.releaseType !== undefined
    ) {
      lines.push(`  📦 ${component.currentVersion} → ${bold(component.newVersion)} (${component.releaseType})`);
    }

    formatBumpFiles(lines, component, result.dryRun, '  ');
    lines.push(dim('  Generating changelogs...'));
    formatChangelogFiles(lines, component, result.dryRun, '  ');

    if (component.tag !== undefined) {
      lines.push(`  🏷️  ${bold(component.tag)}`);
    }
  }

  // Format command
  formatFormatCommand(lines, result);

  // Tag summary
  if (result.tags.length > 0) {
    lines.push(`\n✅ Release preparation complete.`);
    for (const tag of result.tags) {
      lines.push(`   🏷️  ${bold(tag)}`);
    }
  } else {
    lines.push(`\n⏭️  No components had release-worthy changes.`);
  }

  return lines.join('\n');
}

/** Format the "since" text for a component. */
function formatSince(component: ComponentPrepareResult): string {
  return component.previousTag === undefined ? '(no previous release found)' : `since ${component.previousTag}`;
}

/** Append bump file detail lines. */
function formatBumpFiles(lines: string[], component: ComponentPrepareResult, dryRun: boolean, indent = ''): void {
  for (const file of component.bumpedFiles) {
    if (dryRun) {
      lines.push(dim(`${indent}  [dry-run] Would bump ${file}`));
    } else {
      lines.push(dim(`${indent}  Bumped ${file}`));
    }
  }
}

/** Append changelog file detail lines. */
function formatChangelogFiles(lines: string[], component: ComponentPrepareResult, dryRun: boolean, indent = ''): void {
  for (const file of component.changelogFiles) {
    if (dryRun) {
      lines.push(dim(`${indent}  [dry-run] Would run: npx --yes git-cliff ... --output ${file}`));
    } else {
      lines.push(dim(`${indent}  Generating changelog: ${file}`));
    }
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
