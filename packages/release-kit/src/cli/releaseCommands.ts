import { createCli } from '@williamthorsen/nmr-core/cli';

import { commitCommand } from '../commitCommand.ts';
import { createGithubReleaseCommand } from '../createGithubReleaseCommand.ts';
import { enterRepoRoot } from '../enterRepoRoot.ts';
import { parseRequestedTags } from '../parseRequestedTags.ts';
import { prepareCommand } from '../prepareCommand.ts';
import { publishCommand } from '../publishCommand.ts';
import { pushCommand } from '../pushCommand.ts';
import { tagCommand } from '../tagCommand.ts';
import { type CommandContext, CONFIG_FLAG, runReportingFailures } from './commandKit.ts';

const { defineCommand } = createCli<CommandContext>();

const TAGS_FLAG = {
  type: 'string',
  valueHint: 'tag1,tag2',
} as const;

export const prepare = defineCommand({
  summary: 'Run release preparation (auto-discovers workspaces)',
  description: 'Run release preparation with automatic workspace discovery.',
  flags: {
    ...CONFIG_FLAG,
    isDryRun: { type: 'boolean', long: 'dry-run', description: 'Run without modifying any files' },
    bump: {
      type: 'string',
      description: 'Set the level of every release that happens; does not trigger one',
      choices: ['major', 'minor', 'patch'],
    },
    setVersion: {
      type: 'string',
      long: 'set-version',
      description:
        "Set an explicit version; bypasses the changelog-derived bump. In monorepo mode, name each workspace or directory target: --set-version=arrays@1.0.0[,strings@2.0.0]. Rejected when a composite (a 'project' block or a releases composite) is configured.",
      valueHint: 'X.Y.Z',
    },
    shouldForce: {
      type: 'boolean',
      long: 'force',
      description:
        'Release even when the last tag is not followed by any commits, or by any bump-worthy ones. Defaults to patch when --bump is not given; use --bump=X for a different level.',
    },
    shouldSkipGitChecks: {
      type: 'boolean',
      long: 'no-git-checks',
      description: 'Skip the clean-working-tree check',
      short: 'n',
    },
    only: {
      type: 'string',
      description:
        "Release only the named release targets and their dependents (comma-separated, monorepo only). A composite declared under 'releases' releases only when named; a 'project' block's release is skipped.",
      valueHint: 'name1,name2',
    },
    shouldIncludeReleaseNotes: {
      type: 'boolean',
      long: 'with-release-notes',
      description:
        'Also write per-workspace release-notes previews under <workspacePath>/docs/ (docs/README.v<version>.md and docs/RELEASE_NOTES.v<version>.md). Recommended .gitignore entry: packages/*/docs/*.v*.md (or docs/*.v*.md).',
    },
  },
  run: ({ flags, context }) =>
    runReportingFailures(context.styles, async () => {
      enterRepoRoot();
      await prepareCommand({
        bumpOverride: flags.bump,
        configPath: flags.config,
        isDryRun: flags.isDryRun,
        onlyNames: flags.only?.split(','),
        setVersion: flags.setVersion,
        shouldForce: flags.shouldForce,
        shouldIncludeReleaseNotes: flags.shouldIncludeReleaseNotes,
        shouldSkipGitChecks: flags.shouldSkipGitChecks,
        styles: context.styles,
      });
    }),
});

export const commit = defineCommand({
  summary: 'Stage changes and create the release commit',
  description: 'Stage all changes and create the release commit using the tags and summary produced by `prepare`.',
  flags: {
    isDryRun: { type: 'boolean', long: 'dry-run', description: 'Preview the commit message without creating it' },
  },
  run: ({ flags, context }) =>
    runReportingFailures(context.styles, () => {
      enterRepoRoot();
      commitCommand({ isDryRun: flags.isDryRun });
    }),
});

export const tag = defineCommand({
  summary: 'Create annotated git tags from the tags file',
  description: 'Create annotated git tags from the tags file produced by `prepare`.',
  flags: {
    isDryRun: { type: 'boolean', long: 'dry-run', description: 'Preview without creating tags' },
    shouldSkipGitChecks: { type: 'boolean', long: 'no-git-checks', description: 'Skip the dirty-working-tree check' },
  },
  run: ({ flags, context }) =>
    runReportingFailures(context.styles, () => {
      enterRepoRoot();
      tagCommand({ isDryRun: flags.isDryRun, shouldSkipGitChecks: flags.shouldSkipGitChecks, styles: context.styles });
    }),
});

export const push = defineCommand({
  summary: 'Push the release commit and tags (one push per tag)',
  description:
    'Push the release commit and each tag individually, so that GitHub Actions starts a separate workflow run for each tag.',
  flags: {
    ...CONFIG_FLAG,
    isDryRun: { type: 'boolean', long: 'dry-run', description: 'Preview without pushing' },
    tags: { ...TAGS_FLAG, description: 'Only push the named tags (comma-separated, full tag names)' },
    tagsOnly: { type: 'boolean', description: 'Skip the branch push (push tags only)' },
  },
  run: ({ flags, context }) =>
    runReportingFailures(context.styles, async () => {
      enterRepoRoot();
      await pushCommand({
        configPath: flags.config,
        isDryRun: flags.isDryRun,
        tags: parseRequestedTags(flags.tags),
        tagsOnly: flags.tagsOnly,
        styles: context.styles,
      });
    }),
});

export const publish = defineCommand({
  summary: 'Publish packages with release tags on HEAD',
  description:
    'Publish packages that have release tags on HEAD. Operates only on workspaces whose package.json#private is absent or false. Without --tags, unpublishable workspaces are silently filtered out. With --tags, an unpublishable tag is skipped with a warning while any publishable tags are still published. A project tag is never published.',
  flags: {
    ...CONFIG_FLAG,
    isDryRun: { type: 'boolean', long: 'dry-run', description: 'Preview without publishing' },
    shouldSkipGitChecks: { type: 'boolean', long: 'no-git-checks', description: 'Skip the clean-working-tree check' },
    tags: { ...TAGS_FLAG, description: 'Only publish the named tags (comma-separated, full tag names)' },
    shouldGenerateProvenance: {
      type: 'boolean',
      long: 'provenance',
      description: 'Generate a provenance statement (requires OIDC; not supported by classic yarn)',
    },
  },
  run: ({ flags, context }) =>
    runReportingFailures(context.styles, async () => {
      enterRepoRoot();
      await publishCommand({
        configPath: flags.config,
        isDryRun: flags.isDryRun,
        shouldGenerateProvenance: flags.shouldGenerateProvenance,
        shouldSkipGitChecks: flags.shouldSkipGitChecks,
        tags: parseRequestedTags(flags.tags),
        styles: context.styles,
      });
    }),
});

export const createGithubRelease = defineCommand({
  summary: 'Create GitHub Releases from changelog.json for tags on HEAD',
  description:
    "Create GitHub Releases from changelog.json for tags on HEAD. Private (package.json#private) workspaces are skipped with a warning, and the command doesn't create a Release for them. A project tag gets a Release even when the root package is private.",
  flags: {
    ...CONFIG_FLAG,
    isDryRun: { type: 'boolean', long: 'dry-run', description: 'Preview without creating releases' },
    tags: { ...TAGS_FLAG, description: 'Only create releases for the named tags (comma-separated, full tag names)' },
  },
  run: ({ flags, context }) =>
    runReportingFailures(context.styles, async () => {
      enterRepoRoot();
      await createGithubReleaseCommand({
        configPath: flags.config,
        isDryRun: flags.isDryRun,
        tags: parseRequestedTags(flags.tags),
        styles: context.styles,
      });
    }),
});
