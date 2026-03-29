import { stripScope } from './stripScope.ts';
import type { PrepareResult } from './types.ts';

/**
 * Build a release commit body from a prepare result.
 *
 * Each released component with commits gets a section headed by its tag,
 * followed by scope-stripped commit messages as bullet points. Sections
 * are separated by blank lines. Returns an empty string when no released
 * components have commits.
 */
export function buildReleaseSummary(result: PrepareResult): string {
  const sections: string[] = [];

  for (const component of result.components) {
    if (component.status !== 'released' || component.tag === undefined) {
      continue;
    }

    const commits = component.commits;
    if (commits === undefined || commits.length === 0) {
      continue;
    }

    const lines = [component.tag];
    for (const commit of commits) {
      lines.push(`- ${stripScope(commit.message)}`);
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}
