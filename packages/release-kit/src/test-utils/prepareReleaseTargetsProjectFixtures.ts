import { assert } from 'vitest';

import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from '../defaults.ts';
import type { PlannedWrite } from '../releasePlan.ts';
import { prepareReleaseTargets, type TargetPrepareOptions } from '../prepareReleaseTargets.ts';
import { projectMonorepoConfig } from '../resolveReleaseTargets.ts';
import type {
  ChangelogEntry,
  ChangelogSection,
  CompositePrepareResult,
  MalformedChangeRecordBlock,
  MonorepoReleaseConfig,
  PolicyViolation,
  UndeclaredEntryType,
  WorkspaceConfig,
} from '../types.ts';
import { selectCompositeResult } from './prepareResults.ts';
import type { ReleaseHistoryStub } from './releaseHistories.ts';
import { stubHistory } from './prepareReleaseTargetsProjectMocks.ts';

/** The unreleased window's sections in the default history. */
export const UNRELEASED_SECTIONS: ChangelogSection[] = [
  { title: 'Features', audience: 'all', items: [{ description: 'ship project', hash: 'abc123' }] },
];

export const ENTRY_VIOLATION: PolicyViolation = {
  commitHash: 'bbb2222',
  commitSubject: 'Merge PR',
  type: 'drop',
  surface: 'entry',
  entryPosition: 1,
};

export const MALFORMED_BLOCK: MalformedChangeRecordBlock = {
  commitHash: 'aaa1111',
  commitSubject: 'Squash',
  reason: '`entries` is not a list',
};

/** The entry that the default history's unreleased window yields under the default release's tag. */
export const NEW_ENTRY: ChangelogEntry = { version: '0.10.0', date: '2024-01-01', sections: UNRELEASED_SECTIONS };

/** A released window's entry, which the project changelog keeps below the new one. */
export const RELEASED_ENTRY: ChangelogEntry = {
  version: '0.9.0',
  date: '2023-12-01',
  sections: [{ title: 'Bug fixes', audience: 'all', items: [{ description: 'patch arrays', hash: 'fed987' }] }],
};

export const UNDECLARED_ENTRY_TYPE: UndeclaredEntryType = {
  commitHash: 'bbb2222',
  commitSubject: 'Merge PR',
  entryPosition: 2,
  type: 'chore',
};

/** Arguments of {@link prepareProjectStage}: the config, the options, and the lists to which the run's output is appended. */
export interface ProjectStageArgs {
  config: MonorepoReleaseConfig;
  options: TargetPrepareOptions;
  modifiedFiles?: string[];
  writes?: PlannedWrite[];
  tags?: string[];
  warnings?: string[];
}

/** Builds a monorepo config with two workspaces and a project block spanning both. */
export function makeConfig(overrides?: Partial<MonorepoReleaseConfig>): MonorepoReleaseConfig {
  return {
    workspaces: [makeWorkspace({ dir: 'arrays' }), makeWorkspace({ dir: 'strings' })],
    workTypes: { feat: { header: 'Features' }, fix: { header: 'Bug fixes' } },
    changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: false },
    releaseNotes: { ...DEFAULT_RELEASE_NOTES_CONFIG },
    project: { paths: ['packages/arrays/**', 'packages/strings/**'], tagPrefix: 'v' },
    ...overrides,
  };
}

/**
 * Prepares the config's project composite alone, appending the plan's tags, writes, warnings, and format-command files
 * to the given lists, and returns the composite's result.
 */
export function prepareProjectStage(args: ProjectStageArgs): CompositePrepareResult {
  const { targets, settings } = projectMonorepoConfig(args.config);
  const plan = prepareReleaseTargets(
    {
      targets: targets.filter((target) => target.kind === 'composite'),
      // A configured command makes the plan report its modified files.
      settings: { ...settings, formatCommand: 'format' },
    },
    args.options,
  );
  args.tags?.push(...plan.tags);
  args.writes?.push(...plan.writes);
  args.modifiedFiles?.push(...(plan.formatCommand?.files ?? []));
  args.warnings?.push(...(plan.warnings ?? []));
  const result = selectCompositeResult(plan);
  assert(result !== undefined, 'expected a composite result');
  return result;
}

/** Stubs a history above the `v0.9.0` baseline whose one feature commit calls for a minor bump. */
export function stubDefaultHistory(overrides: ReleaseHistoryStub = {}): void {
  stubHistory({
    previousTag: 'v0.9.0',
    commits: [['#1 feat: ship project', 'abc123']],
    bump: 'minor',
    sections: UNRELEASED_SECTIONS,
    ...overrides,
  });
}

// region | Helpers
/** Builds a workspace config under `packages/<dir>`. */
function makeWorkspace(overrides: Partial<WorkspaceConfig> & Pick<WorkspaceConfig, 'dir'>): WorkspaceConfig {
  const { dir } = overrides;
  return {
    name: `@test/${dir}`,
    tagPrefix: `${dir}-v`,
    workspacePath: `packages/${dir}`,
    isPublishable: true,
    packageFiles: [`packages/${dir}/package.json`],
    paths: [`packages/${dir}/**`],
    ...overrides,
  };
}
// endregion | Helpers
