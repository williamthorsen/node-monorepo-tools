import process from 'node:process';

import { createCli } from '@williamthorsen/nmr-core/cli';

import { enterRepoRoot } from '../enterRepoRoot.ts';
import { initCommand } from '../init/initCommand.ts';
import { updateTemplatesCommand } from '../init/updateTemplatesCommand.ts';
import { showTagPrefixesCommand } from '../showTagPrefixesCommand.ts';
import { generateCommand } from '../sync-labels/generateCommand.ts';
import { syncLabelsInitCommand } from '../sync-labels/initCommand.ts';
import { syncLabelsCommand } from '../sync-labels/syncCommand.ts';
import { validateOverridesCommand } from '../validateOverridesCommand.ts';
import { type CommandContext, CONFIG_FLAG, runReportingFailures } from './commandKit.ts';

const { defineCommand, defineGroup } = createCli<CommandContext>();

export const showTagPrefixes = defineCommand({
  summary: 'Show derived and declared legacy tag prefixes per workspace',
  description:
    'Print a per-workspace table of derived tag prefixes, tag counts, and declared legacy tag prefixes. Reports any release-shaped tags whose prefix is neither a derived prefix nor declared in `legacyIdentities`, with a copy-pasteable config snippet.',
  flags: CONFIG_FLAG,
  run: ({ flags, context }) =>
    runReportingFailures(context.styles, () => {
      enterRepoRoot();
      return showTagPrefixesCommand(context.styles, flags.config);
    }),
});

export const init = defineCommand({
  summary: 'Initialize release-kit in the current repository',
  description:
    'Initialize release-kit in the current repository. By default, scaffolds only the GitHub Actions workflow files. When every package is private, skips publish.yaml and create-github-release.yaml.',
  flags: {
    shouldScaffoldConfig: {
      type: 'boolean',
      long: 'with-config',
      description: 'Also scaffold .config/release-kit.config.ts',
    },
    shouldForce: { type: 'boolean', long: 'force', description: 'Overwrite existing files instead of skipping them' },
    isDryRun: { type: 'boolean', long: 'dry-run', description: 'Preview changes without writing files' },
  },
  run: ({ flags, context }) =>
    runReportingFailures(context.styles, () => {
      enterRepoRoot();
      return initCommand({
        isDryRun: flags.isDryRun,
        shouldForce: flags.shouldForce,
        shouldScaffoldConfig: flags.shouldScaffoldConfig,
        styles: context.styles,
      });
    }),
});

export const updateTemplates = defineCommand({
  summary: 'Update the scaffolded workflows to the current templates',
  description:
    "Update the GitHub Actions workflows that release-kit scaffolds to the templates of the installed version, showing what changed in each file. Creates a missing workflow that `init` would create, and refreshes sync-labels.yaml only when it exists. When every package is private, refreshes publish.yaml and create-github-release.yaml only when they exist. Keeps publish.yaml's provenance setting. Never touches config files.",
  flags: {
    isDryRun: { type: 'boolean', long: 'dry-run', description: 'Preview changes without writing files' },
  },
  run: ({ flags, context }) =>
    runReportingFailures(context.styles, () => {
      enterRepoRoot();
      return updateTemplatesCommand({ isDryRun: flags.isDryRun, styles: context.styles });
    }),
});

const overridesValidate = defineCommand({
  summary: 'Validate every `.meta/changelog-overrides.json` file across all scopes',
  description:
    'Validate every `.meta/changelog-overrides.json` file across the project and per-workspace scopes. Reports schema/parse errors, ambiguous-prefix errors, conflicting-key errors, and stale-key warnings.',
  flags: CONFIG_FLAG,
  epilog: `Exit codes:
  0    Clean: no errors, no stale keys
  1    Stale-key warnings only (no errors)
  2    Schema/parse, ambiguous-prefix, or conflicting-key errors (errors take precedence)`,
  run: ({ flags, context }) =>
    runReportingFailures(context.styles, async () => {
      enterRepoRoot();
      const result = await validateOverridesCommand(context.styles, flags.config);
      if (result.exitCode === 0) {
        process.stdout.write(`${result.message}\n`);
      } else {
        process.stderr.write(`${result.message}\n`);
      }
      return result.exitCode;
    }),
});

export const overrides = defineGroup({
  summary: 'Manage editorial changelog overrides',
  commands: { validate: overridesValidate },
});

const syncLabelsInit = defineCommand({
  summary: 'Scaffold caller workflow and config, then generate labels',
  description:
    'Scaffold the sync-labels caller workflow and seed the repoLabels block of .config/release-kit.config.ts with scope labels discovered from workspaces and retired packages, then generate .github/labels.yaml. When the config file already exists, print the block for manual paste instead of rewriting the file.',
  flags: {
    ...CONFIG_FLAG,
    isDryRun: { type: 'boolean', long: 'dry-run', description: 'Preview changes without writing files' },
    shouldForce: { type: 'boolean', long: 'force', description: 'Overwrite existing files instead of skipping them' },
  },
  run: ({ flags, context }) =>
    runReportingFailures(context.styles, () => {
      enterRepoRoot();
      return syncLabelsInitCommand({
        ...(flags.config !== undefined && { configPath: flags.config }),
        isDryRun: flags.isDryRun,
        shouldForce: flags.shouldForce,
        styles: context.styles,
      });
    }),
});

const syncLabelsGenerate = defineCommand({
  summary: 'Regenerate .github/labels.yaml from config',
  description: 'Regenerate .github/labels.yaml from the repoLabels block of .config/release-kit.config.ts.',
  flags: {
    shouldCheck: {
      type: 'boolean',
      long: 'check',
      description: 'Report whether .github/labels.yaml is stale instead of writing it',
    },
    ...CONFIG_FLAG,
  },
  run: ({ flags, context }) =>
    runReportingFailures(context.styles, () => {
      enterRepoRoot();
      return generateCommand({
        shouldCheck: flags.shouldCheck,
        ...(flags.config !== undefined && { configPath: flags.config }),
        styles: context.styles,
      });
    }),
});

const syncLabelsSync = defineCommand({
  summary: 'Trigger the sync-labels workflow via gh CLI',
  description: 'Trigger the sync-labels GitHub Actions workflow via the gh CLI.',
  run: ({ context }) =>
    runReportingFailures(context.styles, () => {
      enterRepoRoot();
      return syncLabelsCommand();
    }),
});

export const syncLabels = defineGroup({
  summary: 'Manage GitHub label synchronization',
  description: 'Manage GitHub label synchronization via preset and custom label definitions.',
  commands: { init: syncLabelsInit, generate: syncLabelsGenerate, sync: syncLabelsSync },
});
