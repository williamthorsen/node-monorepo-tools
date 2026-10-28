import type { StreamStyles } from '@williamthorsen/nmr-core';
import { createTempTree, pointCwdAt, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import type { GenerateChangelogOptions } from '../generateChangelogs.ts';
import { resolvedPackages } from '../test-utils/workspaceResolutions.ts';
import { validateOverridesCommand } from '../validateOverridesCommand.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

describe(validateOverridesCommand, () => {
  describe('buildMonorepoInputs (directory targets)', () => {
    let tree: TempTree;

    beforeEach(() => {
      tree = disposeOnTestFinished(createTempTree({}, { prefix: 'validate-overrides-directory-' }));
      tree.writeAll({
        'package.json': JSON.stringify({ name: 'mono-root', version: '1.0.0' }),
        'packages/foo/package.json': JSON.stringify({ name: 'foo' }),
      });
      disposeOnTestFinished(pointCwdAt(tree.dir, { chdir: true }));
    });

    it('validates a directory target under its own override file, reading its window and routing by its name', async () => {
      tree.write('apps/app/version.json', JSON.stringify({ version: '1.0.0' }));
      const calls: GenerateChangelogOptions[] = [];
      let workspaceFilePaths: string[] = [];

      await validateOverridesCommand(RICH_STYLES, undefined, {
        discoverWorkspaces: () => resolvedPackages(['packages/foo']),
        loadValidatedConfig: () =>
          Promise.resolve({
            status: 'ok',
            configFilePath: '.config/release-kit.config.ts',
            warnings: [],
            config: { releases: { app: { path: 'apps/app' } } },
          }),
        buildEntries: (_config, options) => {
          calls.push(options);
          return [];
        },
        validate: (inputs) => {
          workspaceFilePaths = (inputs.workspaces ?? []).map((scope) => scope.filePath);
          return { errors: [], warnings: [] };
        },
      });

      expect(calls.at(-1)).toStrictEqual({ tagPrefixes: ['app-v'], paths: ['apps/app/**'], scope: 'app' });
      expect(workspaceFilePaths).toStrictEqual([
        'packages/foo/.meta/changelog-overrides.json',
        'apps/app/.meta/changelog-overrides.json',
      ]);
    });
  });
});
