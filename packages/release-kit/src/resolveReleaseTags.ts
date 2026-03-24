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

/** Match single-package tags of the form `v{semver}`, warning if multiple are found. */
function resolveSinglePackageTags(tags: string[]): ResolvedTag[] {
  const matched = tags.filter((tag) => VERSION_PATTERN.test(tag));

  if (matched.length > 1) {
    console.warn(
      `Warning: Multiple version tags found on HEAD: ${matched.join(', ')}. ` +
        `Publishing the same package multiple times is almost certainly unintended. Using only the first tag.`,
    );
    return matched.slice(0, 1).map((tag) => ({ tag, dir: '.', workspacePath: '.' }));
  }

  return matched.map((tag) => ({ tag, dir: '.', workspacePath: '.' }));
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
