import type { StreamStyles } from '@williamthorsen/nmr-core';

import type { CommitCommandOptions } from '../commitCommand.ts';
import type { CreateGithubReleaseCommandOptions } from '../createGithubReleaseCommand.ts';
import type { PrepareCommandOptions } from '../prepareCommand.ts';
import type { PublishCommandOptions } from '../publishCommand.ts';
import type { PushCommandOptions } from '../pushCommand.ts';
import type { TagCommandOptions } from '../tagCommand.ts';

const DEFAULT_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

/** Builds `commit` options as a bare invocation parses them, with the given fields replaced. */
export function makeCommitOptions(overrides: Partial<CommitCommandOptions> = {}): CommitCommandOptions {
  return { isDryRun: false, ...overrides };
}

/** Builds `create-github-release` options as a bare invocation parses them, with the given fields replaced. */
export function makeCreateGithubReleaseOptions(
  overrides: Partial<CreateGithubReleaseCommandOptions> = {},
): CreateGithubReleaseCommandOptions {
  return { configPath: undefined, isDryRun: false, tags: undefined, styles: DEFAULT_STYLES, ...overrides };
}

/** Builds `prepare` options as a bare invocation parses them, with the given fields replaced. */
export function makePrepareOptions(overrides: Partial<PrepareCommandOptions> = {}): PrepareCommandOptions {
  return {
    bumpOverride: undefined,
    configPath: undefined,
    isDryRun: false,
    onlyNames: undefined,
    setVersion: undefined,
    shouldForce: false,
    shouldIncludeReleaseNotes: false,
    shouldSkipGitChecks: false,
    styles: DEFAULT_STYLES,
    ...overrides,
  };
}

/** Builds `publish` options as a bare invocation parses them, with the given fields replaced. */
export function makePublishOptions(overrides: Partial<PublishCommandOptions> = {}): PublishCommandOptions {
  return {
    configPath: undefined,
    isDryRun: false,
    shouldGenerateProvenance: false,
    shouldSkipGitChecks: false,
    tags: undefined,
    styles: DEFAULT_STYLES,
    ...overrides,
  };
}

/** Builds `push` options as a bare invocation parses them, with the given fields replaced. */
export function makePushOptions(overrides: Partial<PushCommandOptions> = {}): PushCommandOptions {
  return {
    configPath: undefined,
    isDryRun: false,
    tags: undefined,
    tagsOnly: false,
    styles: DEFAULT_STYLES,
    ...overrides,
  };
}

/** Builds `tag` options as a bare invocation parses them, with the given fields replaced. */
export function makeTagOptions(overrides: Partial<TagCommandOptions> = {}): TagCommandOptions {
  return { isDryRun: false, shouldSkipGitChecks: false, styles: DEFAULT_STYLES, ...overrides };
}
