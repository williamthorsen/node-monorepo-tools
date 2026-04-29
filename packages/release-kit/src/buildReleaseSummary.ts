import { stripScope } from './stripScope.ts';
import type { PrepareResult } from './types.ts';

/**
 * Build a release commit body from a prepare result.
 *
 * Each released workspace with commits gets a section headed by its tag,
 * followed by scope-stripped commit messages as bullet points. Sections
 * are separated by blank lines. The project release (when present) is
 * appended as a final section using the same format. Returns an empty
 * string when no released workspaces have commits and there is no project
 * release.
 */
export function buildReleaseSummary(result: PrepareResult): string {
  const sections: string[] = [];

  for (const workspace of result.workspaces) {
    if (workspace.status !== 'released' || workspace.tag === undefined) {
      continue;
    }

    const commits = workspace.commits;
    if (commits === undefined || commits.length === 0) {
      continue;
    }

    const lines = [workspace.tag];
    for (const commit of commits) {
      lines.push(`- ${stripScope(commit.message)}`);
    }

    sections.push(lines.join('\n'));
  }

  const project = result.project;
  if (
    project !== undefined &&
    project.status === 'released' &&
    project.tag !== undefined &&
    project.commits !== undefined &&
    project.commits.length > 0
  ) {
    const lines = [project.tag];
    for (const commit of project.commits) {
      lines.push(`- ${stripScope(commit.message)}`);
    }
    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}
