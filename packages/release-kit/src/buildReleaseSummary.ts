import { stripScope } from './stripScope.ts';
import type { PrepareResult } from './types.ts';

/**
 * Builds a release commit body from a prepare result: one section per released workspace or project that has commits,
 * the project last, each headed by its tag and listing its scope-stripped commit subjects.
 */
export function buildReleaseSummary(result: Pick<PrepareResult, 'project' | 'workspaces'>): string {
  const sections: string[] = [];

  for (const workspace of result.workspaces) {
    if (workspace.status !== 'released') {
      continue;
    }

    const commits = workspace.commits;
    if (commits === undefined || commits.length === 0) {
      continue;
    }

    const lines = [workspace.tag];
    for (const commit of commits) {
      lines.push(`- ${stripScope(commit.subject)}`);
    }

    sections.push(lines.join('\n'));
  }

  const project = result.project;
  if (project !== undefined && project.status === 'released' && project.commits.length > 0) {
    const lines = [project.tag];
    for (const commit of project.commits) {
      lines.push(`- ${stripScope(commit.subject)}`);
    }
    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}
