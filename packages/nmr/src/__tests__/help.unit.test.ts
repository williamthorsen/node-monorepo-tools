import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { describeHelp } from '../help.ts';
import { buildMonorepo } from '../test-utils/fixture-repo.ts';

/** A directory without `pnpm-workspace.yaml`, for which the root lint commands do not exclude anything. */
const NON_WORKSPACE_DIR = import.meta.dirname;

/** The footnote that explains the marker on an overridden row. */
const OVERRIDE_FOOTNOTE = '* Overridden by package.json';

const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-help-test-' })),
);

describe(describeHelp, () => {
  // The listing reads the same tier-3 scripts as resolution does, so a malformed entry stops it rather than being
  // omitted from a help text that looks complete.
  it('rejects a malformed package.json script rather than omitting it', ({ tree }) => {
    tree.writeJson('package.json', { scripts: { build: ['compile'] } });

    expect(() => describeHelp({}, NON_WORKSPACE_DIR, tree.dir, false)).toThrow('`scripts.build` must be a string');
  });

  it('names the environment variables and the user config file', () => {
    const { epilog } = describeHelp({}, NON_WORKSPACE_DIR, undefined, false);

    expect(epilog).toContain('NMR_DELEGATE');
    expect(epilog).toContain('NMR_OUTPUT_STYLE');
    expect(epilog).toContain('~/.config/nmr/config.ts     User config');
    expect(epilog).toContain('$XDG_CONFIG_HOME/nmr/config.ts');
    expect(epilog).toContain('A command that it sends runs here when no host answers');
  });

  it('lists the workspace commands, and the root commands in the epilog, in a package', () => {
    const { commands, epilog } = describeHelp({}, NON_WORKSPACE_DIR, undefined, false);

    expect(readNames(commands)).toStrictEqual(expect.arrayContaining(['build', 'test', 'typecheck']));
    expect(readNames(commands)).not.toContain('report-overrides');
    expect(readSection(epilog, 'Root commands:')).toContain('report-overrides');
  });

  it('lists the root commands, and the workspace commands in the epilog, at the root', () => {
    const { commands, epilog } = describeHelp({}, NON_WORKSPACE_DIR, undefined, true);

    expect(readNames(commands)).toStrictEqual(expect.arrayContaining(['ci', 'report-overrides']));
    expect(readSection(epilog, 'Workspace commands:')).toContain('typecheck');
  });

  it('includes config-defined scripts', () => {
    const config = {
      workspaceScripts: { 'copy-content': 'tsx scripts/copy-content.ts' },
      rootScripts: { 'demo:catwalk': 'pnpx http-server' },
    };

    expect(describeHelp(config, NON_WORKSPACE_DIR, undefined, false).commands).toContainEqual([
      'copy-content',
      'tsx scripts/copy-content.ts',
    ]);
    expect(describeHelp(config, NON_WORKSPACE_DIR, undefined, true).commands).toContainEqual([
      'demo:catwalk',
      'pnpx http-server',
    ]);
  });

  it.for([
    { shouldUseRoot: false, config: { workspaceScripts: { 'build:pre': 'npx rdy compile' } }, hook: 'build:pre' },
    { shouldUseRoot: true, config: { rootScripts: { 'build:post': 'echo built' } }, hook: 'build:post' },
  ])('omits a config-defined hook ($hook)', ({ config, hook, shouldUseRoot }) => {
    const { commands, epilog } = describeHelp(config, NON_WORKSPACE_DIR, undefined, shouldUseRoot);

    expect(readNames(commands)).not.toContain(hook);
    expect(epilog).not.toContain(hook);
  });

  describe('package.json scripts', () => {
    it.for<{ name: string; shouldUseRoot: boolean; value: string }>([
      { name: 'custom-task', shouldUseRoot: false, value: 'echo custom' },
      { name: 'bootstrap', shouldUseRoot: true, value: 'pnpm run prepare' },
      { name: 'build:pre', shouldUseRoot: false, value: 'rdy verify' },
      // The registry is a plain object, so `'toString' in registry` is true and the entry would otherwise be written
      // in as though it were overriding a real command.
      { name: 'toString', shouldUseRoot: false, value: 'sentinel-prototype-value' },
    ])(
      'lists an unregistered script ($name) with its command and no marker',
      ({ name, shouldUseRoot, value }, { tree }) => {
        tree.writeJson('package.json', { name: 'pkg', scripts: { [name]: value } });

        const { commands, epilog } = describeHelp({}, NON_WORKSPACE_DIR, tree.dir, shouldUseRoot);

        expect(commands).toContainEqual([name, value]);
        expect(epilog).not.toContain(OVERRIDE_FOOTNOTE);
      },
    );

    it('omits a package entry overriding a registry hook', ({ tree }) => {
      tree.writeJson('package.json', { name: 'pkg', scripts: { 'build:pre': 'sentinel-hook-value' } });

      const { commands } = describeHelp(
        { workspaceScripts: { 'build:pre': 'npx rdy compile' } },
        NON_WORKSPACE_DIR,
        tree.dir,
        false,
      );

      expect(readNames(commands)).not.toContain('build:pre');
    });

    it('lists a script whose name only the inactive registry contains', ({ tree }) => {
      tree.writeJson('package.json', { name: 'pkg', scripts: { audit: 'sentinel-audit' } });

      expect(describeHelp({}, NON_WORKSPACE_DIR, tree.dir, false).commands).toContainEqual(['audit', 'sentinel-audit']);
    });

    it('omits generic pnpm lifecycle entries', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'pkg',
        scripts: { prepare: 'echo prepare', postinstall: 'echo postinstall', prepublishOnly: 'echo publish' },
      });

      const names = readNames(describeHelp({}, NON_WORKSPACE_DIR, tree.dir, false).commands);

      expect(names).not.toContain('prepare');
      expect(names).not.toContain('postinstall');
      expect(names).not.toContain('prepublishOnly');
    });

    it('omits a self-referential entry that the registry does not contain', ({ tree }) => {
      tree.writeJson('package.json', { name: 'pkg', scripts: { 'custom-task': 'nmr custom-task' } });

      expect(readNames(describeHelp({}, NON_WORKSPACE_DIR, tree.dir, false).commands)).not.toContain('custom-task');
    });

    it.for<{ shouldUseRoot: boolean }>([{ shouldUseRoot: false }, { shouldUseRoot: true }])(
      'lists an override once, marked, with the footnote (root: $shouldUseRoot)',
      ({ shouldUseRoot }, { tree }) => {
        tree.writeJson('package.json', { name: 'pkg', scripts: { lint: 'pkg-linter' } });

        const { commands, epilog } = describeHelp({}, NON_WORKSPACE_DIR, tree.dir, shouldUseRoot);

        expect(commands.filter(([name]) => name === 'lint')).toStrictEqual([['lint', 'pkg-linter *']]);
        expect(epilog).not.toContain('pkg-linter');
        expect(epilog).toContain(OVERRIDE_FOOTNOTE);
      },
    );

    it.for<Record<string, string>>([{ build: 'nmr build' }, { build: 'rdy compile && nmr build' }])(
      // Resolution discards the entry, so rendering it as the command's value would name something nmr never runs.
      'does not mark or override a self-referential entry: %j',
      (scripts, { tree }) => {
        tree.writeJson('package.json', { name: 'pkg', scripts });

        const { commands, epilog } = describeHelp({}, NON_WORKSPACE_DIR, tree.dir, false);

        expect(commands.find(([name]) => name === 'build')?.[1]).not.toMatch(/\*$|rdy compile/);
        expect(epilog).not.toContain(OVERRIDE_FOOTNOTE);
      },
    );
  });

  describe('test commands', () => {
    it('lists all six test commands for every package', ({ tree }) => {
      const { commands } = describeHelp({}, NON_WORKSPACE_DIR, tree.dir, false);

      expect(readNames(commands)).toStrictEqual(
        expect.arrayContaining(['test', 'test:all', 'test:coverage', 'test:tool', 'test:unit', 'test:watch']),
      );
      expect(commands.map(([, summary]) => summary)).toContain('nmr-vitest --project unit --project tool');
    });

    // Help renders the registry, so an on-disk probe anywhere in resolution would change the listing here.
    it('lists the same commands when the retired variant config is present', ({ tree }) => {
      const bare = describeHelp({}, NON_WORKSPACE_DIR, tree.dir, false).commands;
      tree.write('vitest.integration.config.ts', '');
      tree.write('vitest.standalone.config.ts', '');

      expect(describeHelp({}, NON_WORKSPACE_DIR, tree.dir, false).commands).toStrictEqual(bare);
    });

    it('lists the root test selections in root context', ({ tree }) => {
      expect(readNames(describeHelp({}, NON_WORKSPACE_DIR, tree.dir, true).commands)).toStrictEqual(
        expect.arrayContaining([
          'root:test',
          'root:test:all',
          'root:test:tool',
          'root:test:unit',
          'test:all',
          'test:tool',
          'test:unit',
        ]),
      );
    });

    it('lists each root lint command with the workspaces that it excludes, from either scope', () => {
      const root = buildMonorepo({
        'apps/web/package.json': '{ "name": "web" }\n',
        'packages/lib/package.json': '{ "name": "lib" }\n',
        'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n',
      });
      const exclusions = "--ignore-pattern 'apps/web/**' --ignore-pattern 'packages/lib/**' .";

      const fromRoot = describeHelp({}, root, root, true)
        .commands.map(([, summary]) => summary)
        .join('\n');
      const fromPackage = readSection(describeHelp({}, root, `${root}/apps/web`, false).epilog, 'Root commands:');

      for (const listing of [fromRoot, fromPackage]) {
        expect(listing).toContain(`eslint --fix ${exclusions}`);
        expect(listing).toContain(`eslint ${exclusions}`);
        expect(listing).toContain(`strict-lint ${exclusions}`);
      }
    });

    it('describes a delegating root selection as the steps that it runs', ({ tree }) => {
      const { commands } = describeHelp({}, NON_WORKSPACE_DIR, tree.dir, true);

      expect(commands.map(([, summary]) => summary)).toContain('[root:test, -R test]');
    });
  });
});

// region | Helpers

/** Returns the name of every listed command. */
function readNames(commands: ReadonlyArray<[string, string]>): string[] {
  return commands.map(([name]) => name);
}

/** Returns the part of `text` from `start` to the next blank line, or the empty string when `start` is absent. */
function readSection(text: string, start: string): string {
  const startIndex = text.indexOf(start);
  if (startIndex === -1) return '';
  const endIndex = text.indexOf('\n\n', startIndex);
  return endIndex === -1 ? text.slice(startIndex) : text.slice(startIndex, endIndex);
}

// endregion | Helpers
