import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from '../defaults.ts';
import type { ReleasePlan } from '../releasePlan.ts';
import { prepareReleaseTargets, type TargetPrepareOptions } from '../prepareReleaseTargets.ts';
import { projectMonorepoConfig } from '../resolveReleaseTargets.ts';
import type { ChangelogEntry, MonorepoReleaseConfig, WorkspaceConfig, WorkTypeConfig } from '../types.ts';
import { stubFiles } from './prepareReleaseTargetsMonorepoMocks.ts';

/** An entry of a released window, which a history reports alongside its unreleased window. */
export const RELEASED_ENTRY: ChangelogEntry = {
  version: '1.0.0',
  date: '2023-12-01',
  sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Initial release', hash: 'old0001' }] }],
};

export const workTypes: Record<string, WorkTypeConfig> = {
  feat: { header: 'Features' },
  fix: { header: 'Bug fixes' },
};

/** Returns the content that the plan intends to write to `path`, or undefined when the plan does not write it. */
export function findPlannedContent(
  plan: { writes: readonly { path: string; content: string }[] },
  path: string,
): string | undefined {
  return plan.writes.find((write) => write.path === path)?.content;
}

/** Builds a monorepo config without any workspaces and the changelog JSON disabled, overriding any field. */
export function makeConfig(overrides?: Partial<MonorepoReleaseConfig>): MonorepoReleaseConfig {
  return {
    workspaces: [],
    workTypes,
    changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: false },
    releaseNotes: { ...DEFAULT_RELEASE_NOTES_CONFIG },
    ...overrides,
  };
}

/** Builds a workspace config whose paths, files, and tag prefix follow from `dir`. */
export function makeRoutedWorkspace(dir: string): WorkspaceConfig {
  return {
    dir,
    name: `@test/${dir}`,
    tagPrefix: `${dir}-v`,
    workspacePath: `packages/${dir}`,
    isPublishable: true,
    packageFiles: [`packages/${dir}/package.json`],
    paths: [`packages/${dir}/**`],
  };
}

/** Prepares a monorepo release over the targets that the merged config projects onto. */
export function prepareMonorepo(config: MonorepoReleaseConfig, options: TargetPrepareOptions): ReleasePlan {
  return prepareReleaseTargets(projectMonorepoConfig(config), options);
}

/** Stubs `core` 1.0.0 and `app` 2.0.0 depending on it, beside any other `files`, and returns their config. */
export function stubPropagationWorkspaces(
  overrides?: Partial<MonorepoReleaseConfig>,
  files?: Record<string, string>,
): MonorepoReleaseConfig {
  stubFiles({
    'packages/core/package.json': JSON.stringify({ name: '@test/core', version: '1.0.0' }),
    'packages/app/package.json': JSON.stringify({
      name: '@test/app',
      version: '2.0.0',
      dependencies: { '@test/core': 'workspace:*' },
    }),
    ...files,
  });
  return makeConfig({ workspaces: [makeRoutedWorkspace('core'), makeRoutedWorkspace('app')], ...overrides });
}
