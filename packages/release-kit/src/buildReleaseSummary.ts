import { stripScope } from './stripScope.ts';
import type { PrepareResult } from './types.ts';

/**
 * Builds a release commit body from a prepare result: one section per released target that has commits, in result
 * order, each headed by its tag and listing its scope-stripped commit subjects.
 */
export function buildReleaseSummary(result: Pick<PrepareResult, 'targets'>): string {
  const sections: string[] = [];

  for (const target of result.targets) {
    if (target.status !== 'released') {
      continue;
    }

    const commits = target.commits;
    if (commits === undefined || commits.length === 0) {
      continue;
    }

    const lines = [target.tag];
    for (const commit of commits) {
      lines.push(`- ${stripScope(commit.subject)}`);
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}
