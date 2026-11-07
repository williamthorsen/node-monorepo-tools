import path from 'node:path';
import process from 'node:process';

import { UserError } from '@williamthorsen/nmr-core';
import { UsageError } from '@williamthorsen/nmr-core/cli';
import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { commitCommand } from '../commitCommand.ts';
import { createGithubReleaseCommand } from '../createGithubReleaseCommand.ts';
import { enterRepoRoot } from '../enterRepoRoot.ts';
import { initCommand } from '../init/initCommand.ts';
import { updateTemplatesCommand } from '../init/updateTemplatesCommand.ts';
import { ConfigProblemError } from '../loadValidatedConfig.ts';
import { prepareCommand } from '../prepareCommand.ts';
import { publishCommand } from '../publishCommand.ts';
import { pushCommand } from '../pushCommand.ts';
import { routeCommand } from '../route.ts';
import { showTagPrefixesCommand } from '../showTagPrefixesCommand.ts';
import { generateCommand } from '../sync-labels/generateCommand.ts';
import { syncLabelsInitCommand } from '../sync-labels/initCommand.ts';
import { syncLabelsCommand } from '../sync-labels/syncCommand.ts';
import { tagCommand } from '../tagCommand.ts';
import { validateOverridesCommand } from '../validateOverridesCommand.ts';

vi.mock(import('../commitCommand.ts'), () => ({ commitCommand: vi.fn() }));
vi.mock(import('../createGithubReleaseCommand.ts'), () => ({ createGithubReleaseCommand: vi.fn() }));
vi.mock(import('../enterRepoRoot.ts'), () => ({ enterRepoRoot: vi.fn() }));
vi.mock(import('../init/initCommand.ts'), () => ({ initCommand: vi.fn().mockReturnValue(0) }));
vi.mock(import('../init/updateTemplatesCommand.ts'), () => ({ updateTemplatesCommand: vi.fn().mockReturnValue(0) }));
vi.mock(import('../prepareCommand.ts'), () => ({ prepareCommand: vi.fn() }));
vi.mock(import('../publishCommand.ts'), () => ({ publishCommand: vi.fn() }));
vi.mock(import('../pushCommand.ts'), () => ({ pushCommand: vi.fn() }));
vi.mock(import('../showTagPrefixesCommand.ts'), () => ({ showTagPrefixesCommand: vi.fn().mockResolvedValue(0) }));
vi.mock(import('../sync-labels/generateCommand.ts'), () => ({ generateCommand: vi.fn().mockResolvedValue(0) }));
vi.mock(import('../sync-labels/initCommand.ts'), () => ({ syncLabelsInitCommand: vi.fn().mockResolvedValue(0) }));
vi.mock(import('../sync-labels/syncCommand.ts'), () => ({ syncLabelsCommand: vi.fn().mockReturnValue(0) }));
vi.mock(import('../tagCommand.ts'), () => ({ tagCommand: vi.fn() }));
vi.mock(import('../validateOverridesCommand.ts'), () => ({ validateOverridesCommand: vi.fn() }));

const COMMANDS = [
  commitCommand,
  createGithubReleaseCommand,
  generateCommand,
  initCommand,
  prepareCommand,
  publishCommand,
  pushCommand,
  showTagPrefixesCommand,
  syncLabelsCommand,
  syncLabelsInitCommand,
  tagCommand,
  updateTemplatesCommand,
  validateOverridesCommand,
];

const STYLES = { stderr: 'plain', stdout: 'plain' };

describe(routeCommand, () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  describe('dispatch', () => {
    it('passes prepare its defaults when no flag is given', async () => {
      await expect(runQuietly(['prepare'])).resolves.toBe(0);

      expect(prepareCommand).toHaveBeenCalledWith({
        bumpOverride: undefined,
        configPath: undefined,
        isDryRun: false,
        onlyNames: undefined,
        setVersion: undefined,
        shouldForce: false,
        shouldIncludeReleaseNotes: false,
        shouldSkipGitChecks: false,
        styles: STYLES,
      });
    });

    it('passes prepare every flag that it takes', async () => {
      await runQuietly([
        'prepare',
        '--dry-run',
        '--bump=minor',
        '--set-version',
        'arrays@1.0.0,strings@2.0.0',
        '--force',
        '-n',
        '--only=arrays,strings',
        '--with-release-notes',
      ]);

      expect(prepareCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          bumpOverride: 'minor',
          isDryRun: true,
          onlyNames: ['arrays', 'strings'],
          setVersion: 'arrays@1.0.0,strings@2.0.0',
          shouldForce: true,
          shouldIncludeReleaseNotes: true,
          shouldSkipGitChecks: true,
        }),
      );
    });

    it.each([
      ['prepare', prepareCommand],
      ['push', pushCommand],
      ['publish', publishCommand],
      ['create-github-release', createGithubReleaseCommand],
    ])('resolves a relative --config for %s against the invocation directory', async (command, run) => {
      await runQuietly([command, '--config', 'elsewhere/alt.config.ts']);

      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ configPath: path.resolve(process.cwd(), 'elsewhere/alt.config.ts') }),
      );
    });

    it('passes an absolute --config unchanged', async () => {
      await runQuietly(['push', '--config=/elsewhere/alt.config.ts']);

      expect(pushCommand).toHaveBeenCalledWith(expect.objectContaining({ configPath: '/elsewhere/alt.config.ts' }));
    });

    it.each([
      ['core-v1.0.0,cli-v2.0.0', ['core-v1.0.0', 'cli-v2.0.0']],
      [',core-v1.0.0,,', ['core-v1.0.0']],
      [',,', undefined],
    ])('splits --tags=%s into %j', async (value, tags) => {
      await runQuietly(['publish', `--tags=${value}`]);

      expect(publishCommand).toHaveBeenCalledWith(expect.objectContaining({ tags }));
    });

    it.each([
      [['commit', '--dry-run'], commitCommand, { isDryRun: true }],
      [['tag', '--no-git-checks'], tagCommand, { isDryRun: false, shouldSkipGitChecks: true, styles: STYLES }],
      [
        ['push', '--tags-only', '--dry-run'],
        pushCommand,
        { configPath: undefined, isDryRun: true, tags: undefined, tagsOnly: true, styles: STYLES },
      ],
      [
        ['publish', '--provenance', '--no-git-checks'],
        publishCommand,
        {
          configPath: undefined,
          isDryRun: false,
          shouldGenerateProvenance: true,
          shouldSkipGitChecks: true,
          tags: undefined,
          styles: STYLES,
        },
      ],
      [
        ['create-github-release', '--tags=core-v1.0.0'],
        createGithubReleaseCommand,
        { configPath: undefined, isDryRun: false, tags: ['core-v1.0.0'], styles: STYLES },
      ],
      [
        ['init', '--with-config', '--force', '--dry-run'],
        initCommand,
        { isDryRun: true, shouldForce: true, shouldScaffoldConfig: true, styles: STYLES },
      ],
      [['update-templates', '--dry-run'], updateTemplatesCommand, { isDryRun: true, styles: STYLES }],
      [
        ['sync-labels', 'init', '--force'],
        syncLabelsInitCommand,
        { isDryRun: false, shouldForce: true, styles: STYLES },
      ],
      [['sync-labels', 'generate', '--check'], generateCommand, { shouldCheck: true, styles: STYLES }],
    ])('dispatches %j', async (args, run, options) => {
      await expect(runQuietly(args)).resolves.toBe(0);

      expect(run).toHaveBeenCalledExactlyOnceWith(options);
    });

    it('dispatches show-tag-prefixes and returns its exit code', async () => {
      vi.mocked(showTagPrefixesCommand).mockResolvedValueOnce(1);

      await expect(runQuietly(['show-tag-prefixes', '--config', '/alt.config.ts'])).resolves.toBe(1);
      expect(showTagPrefixesCommand).toHaveBeenCalledWith(STYLES, '/alt.config.ts');
    });

    it('dispatches sync-labels sync', async () => {
      await expect(runQuietly(['sync-labels', 'sync'])).resolves.toBe(0);
      expect(syncLabelsCommand).toHaveBeenCalledTimes(1);
    });

    it.each([
      [0, 'stdout'],
      [1, 'stderr'],
      [2, 'stderr'],
    ] as const)('prints the overrides validate message for exit code %i to %s', async (exitCode, stream) => {
      vi.mocked(validateOverridesCommand).mockResolvedValueOnce({ exitCode, message: 'the result' });
      const stdio = disposeOnTestFinished(captureStdio());

      await expect(routeCommand(['overrides', 'validate'])).resolves.toBe(exitCode);
      expect(stdio[stream]).toBe('the result\n');
    });

    it('enters the repo root before running a command', async () => {
      vi.mocked(enterRepoRoot).mockImplementationOnce(() => {
        throw new UserError('No repo root found from /nowhere');
      });

      await expect(runQuietly(['commit'])).resolves.toBe(1);
      expect(commitCommand).not.toHaveBeenCalled();
    });

    it('takes the style of both streams from the output-style variable', async () => {
      vi.stubEnv('RELEASE_KIT_OUTPUT_STYLE', 'rich');

      await runQuietly(['tag']);

      expect(tagCommand).toHaveBeenCalledWith(expect.objectContaining({ styles: { stderr: 'rich', stdout: 'rich' } }));
    });
  });

  describe('usage errors', () => {
    it.each([
      [['prepare', '--bogus'], 'Unknown option: --bogus', 'release-kit prepare'],
      [['push', '--only=core'], 'Unknown option: --only', 'release-kit push'],
      [['publish', '--only=core'], 'Unknown option: --only', 'release-kit publish'],
      [['commit', '--config', 'alt.config.ts'], 'Unknown option: --config', 'release-kit commit'],
      [['tag', '--config', 'alt.config.ts'], 'Unknown option: --config', 'release-kit tag'],
      [['create-github-release', '--tags='], 'Missing value for option: --tags', 'release-kit create-github-release'],
      [['prepare', '--only='], 'Missing value for option: --only', 'release-kit prepare'],
      [['sync-labels', 'sync', 'extra'], 'Unexpected positional argument: extra', 'release-kit sync-labels sync'],
      [['bogus'], 'Unknown command: bogus', 'release-kit'],
      [[], 'A command is required.', 'release-kit'],
      [['overrides'], 'A command is required.', 'release-kit overrides'],
      [['sync-labels', 'bogus'], 'Unknown command: bogus', 'release-kit sync-labels'],
    ])('exits 2 for %j', async (args, message, scope) => {
      const stdio = disposeOnTestFinished(captureStdio());

      await expect(routeCommand(args)).resolves.toBe(2);

      expect(stdio.stderr).toBe(`Error: ${message}\nTry '${scope} --help'.\n`);
      expectNoCommandRan();
    });

    it('rejects a --bump outside its choices', async () => {
      const stdio = disposeOnTestFinished(captureStdio());

      await expect(routeCommand(['prepare', '--bump=huge'])).resolves.toBe(2);
      expect(stdio.stderr).toContain('--bump');
      expect(stdio.stderr).toContain('major');
      expect(prepareCommand).not.toHaveBeenCalled();
    });

    it('reports a UsageError that a command throws, and exits 2', async () => {
      vi.mocked(prepareCommand).mockRejectedValueOnce(
        new UsageError('--only is only supported for monorepo configurations'),
      );
      const stdio = disposeOnTestFinished(captureStdio());

      await expect(routeCommand(['prepare', '--only=a'])).resolves.toBe(2);
      expect(stdio.stderr).toBe(
        "Error: --only is only supported for monorepo configurations\nTry 'release-kit prepare --help'.\n",
      );
    });

    it.each([[['prepare']], [['sync-labels', 'sync']]])(
      'exits 2 for %j when the output-style variable does not name a style',
      async (args) => {
        const stdio = disposeOnTestFinished(captureStdio());
        vi.stubEnv('RELEASE_KIT_OUTPUT_STYLE', 'loud');

        await expect(routeCommand(args)).resolves.toBe(2);
        expect(stdio.stderr).toContain(
          'Error: RELEASE_KIT_OUTPUT_STYLE must be one of: auto, plain, rich (got "loud")',
        );
        expectNoCommandRan();
      },
    );
  });

  describe('failures', () => {
    it('reports a config that fails to load as `Error: Failed to load config:`, and exits 1', async () => {
      vi.mocked(pushCommand).mockRejectedValueOnce(
        new ConfigProblemError({ kind: 'load', message: 'Config file not found: /repo/absent.config.ts' }),
      );
      const stdio = disposeOnTestFinished(captureStdio());

      await expect(routeCommand(['push'])).resolves.toBe(1);
      expect(stdio.stderr).toBe('Error: Failed to load config: Config file not found: /repo/absent.config.ts\n');
    });

    it('reports an invalid config line by line in the style of stderr, and exits 1', async () => {
      vi.stubEnv('RELEASE_KIT_OUTPUT_STYLE', 'plain');
      vi.mocked(prepareCommand).mockRejectedValueOnce(
        new ConfigProblemError({ kind: 'validation', errors: ["Unknown field: 'unknownField'"] }),
      );
      const stdio = disposeOnTestFinished(captureStdio());

      await expect(routeCommand(['prepare'])).resolves.toBe(1);
      expect(stdio.stderr).toMatch(/^Invalid config:\n {2}FAIL {2}Unknown field: 'unknownField'\n$/);
    });

    it('reports a UserError from a command, and exits 1', async () => {
      vi.mocked(publishCommand).mockRejectedValueOnce(new UserError('HEAD does not have any release tags.'));
      const stdio = disposeOnTestFinished(captureStdio());

      await expect(routeCommand(['publish'])).resolves.toBe(1);
      expect(stdio.stderr).toBe('Error: HEAD does not have any release tags.\n');
    });

    it('rethrows an unexpected error from a command for the crash handler', async () => {
      const crash = new TypeError('cannot read x');
      vi.mocked(tagCommand).mockImplementationOnce(() => {
        throw crash;
      });

      await expect(routeCommand(['tag'])).rejects.toBe(crash);
    });
  });

  describe('help and version', () => {
    it.each([['--version'], ['-V']])('prints the version for %s', async (flag) => {
      const stdio = disposeOnTestFinished(captureStdio());

      await expect(routeCommand([flag])).resolves.toBe(0);
      expect(stdio.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
    });

    it('lists every command and the output-style variable in the root help', async () => {
      const stdio = disposeOnTestFinished(captureStdio());

      await expect(routeCommand(['--help'])).resolves.toBe(0);
      for (const command of [
        'prepare',
        'commit',
        'tag',
        'push',
        'publish',
        'create-github-release',
        'show-tag-prefixes',
        'init',
        'update-templates',
        'overrides',
        'sync-labels',
      ]) {
        expect(stdio.stdout).toContain(`  ${command} `);
      }
      expect(stdio.stdout).toContain('RELEASE_KIT_OUTPUT_STYLE');
      expectNoCommandRan();
    });

    it.each([
      [
        ['prepare'],
        [
          '--config',
          '--dry-run',
          '--bump',
          '--set-version',
          '--force',
          '-n, --no-git-checks',
          '--only',
          '--with-release-notes',
        ],
      ],
      [['commit'], ['--dry-run']],
      [['tag'], ['--dry-run', '--no-git-checks']],
      [['push'], ['--config', '--dry-run', '--tags', '--tags-only']],
      [['publish'], ['--config', '--dry-run', '--no-git-checks', '--tags', '--provenance']],
      [['create-github-release'], ['--config', '--dry-run', '--tags']],
      [['show-tag-prefixes'], ['--config']],
      [['init'], ['--with-config', '--force', '--dry-run']],
      [['update-templates'], ['--dry-run']],
      [
        ['overrides', 'validate'],
        ['--config', 'Exit codes:'],
      ],
      [
        ['sync-labels', 'init'],
        ['--config', '--dry-run', '--force'],
      ],
      [
        ['sync-labels', 'generate'],
        ['--check', '--config'],
      ],
    ])('prints the options of %j on its own help page', async (command, options) => {
      const stdio = disposeOnTestFinished(captureStdio());

      await expect(routeCommand([...command, '--help'])).resolves.toBe(0);
      expect(stdio.stdout).toContain(`Usage: release-kit ${command.join(' ')}`);
      for (const option of options) {
        expect(stdio.stdout).toContain(option);
      }
      expectNoCommandRan();
      expect(enterRepoRoot).not.toHaveBeenCalled();
    });

    it('lists the commands of a group on its help page', async () => {
      const stdio = disposeOnTestFinished(captureStdio());

      await expect(routeCommand(['sync-labels', '--help'])).resolves.toBe(0);
      for (const command of ['init', 'generate', 'sync']) {
        expect(stdio.stdout).toContain(`  ${command} `);
      }
    });
  });
});

// region | Helpers

/** Asserts that none of the command modules ran. */
function expectNoCommandRan(): void {
  for (const command of COMMANDS) {
    expect(command).not.toHaveBeenCalled();
  }
}

/** Routes the arguments with stdout and stderr captured and the output-style variable set to plain. */
async function runQuietly(args: string[]): Promise<number> {
  disposeOnTestFinished(captureStdio());
  if (process.env['RELEASE_KIT_OUTPUT_STYLE'] === undefined) {
    vi.stubEnv('RELEASE_KIT_OUTPUT_STYLE', 'plain');
  }
  return routeCommand(args);
}

// endregion | Helpers
