import { execFileSync } from 'node:child_process';

export interface ResolvedTag {
  tag: string;
  dir: string;
  workspacePath: string;
}

/** Pattern matching a version suffix like `v1.2.3` or `v0.10.0-beta.1`. */
const VERSION_PATTERN = /^v\d+\.\d+\.\d+/;

/**
 * Resolve release tags pointing at HEAD into publishable package descriptors.
 *
 * In single-package mode (no `workspaceMap`), match tags like `v1.2.3`.
 * In monorepo mode, match `{dir}-v{semver}` tags against the provided workspace map.
 */
export function resolveReleaseTags(workspaceMap?: Map<string, string>): ResolvedTag[] {
  const output = execFileSync('git', ['tag', '--points-at', 'HEAD'], { encoding: 'utf8' });

  const tags = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (workspaceMap === undefined) {
    return resolveSinglePackageTags(tags);
  }

  return resolveMonorepoTags(tags, workspaceMap);
}

/** Match single-package tags of the form `v{semver}`. */
function resolveSinglePackageTags(tags: string[]): ResolvedTag[] {
  return tags.filter((tag) => VERSION_PATTERN.test(tag)).map((tag) => ({ tag, dir: '.', workspacePath: '.' }));
}

/** Match monorepo tags of the form `{dir}-v{semver}` against the workspace map. */
function resolveMonorepoTags(tags: string[], workspaceMap: Map<string, string>): ResolvedTag[] {
  const resolved: ResolvedTag[] = [];

  for (const tag of tags) {
    const dashV = tag.lastIndexOf('-v');
    if (dashV === -1) {
      continue;
    }

    const dir = tag.slice(0, dashV);
    const versionPart = tag.slice(dashV + 1);

    if (!VERSION_PATTERN.test(versionPart)) {
      continue;
    }

    const workspacePath = workspaceMap.get(dir);
    if (workspacePath !== undefined) {
      resolved.push({ tag, dir, workspacePath });
    }
  }

  return resolved;
}
