import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { generateHelp } from '../help.ts';
import { buildMonorepo } from '../test-utils/fixture-repo.ts';

/** A directory without `pnpm-workspace.yaml`, for which the root lint commands do not exclude anything. */
const NON_WORKSPACE_DIR = import.meta.dirname;

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-help-test-' })),
);

describe(generateHelp, () => {
  // The listing reads the same tier-3 scripts as resolution does, so a malformed entry stops it rather than being
  // omitted from a help text that looks complete.
  it('rejects a malformed package.json script rather than omitting it', ({ tree }) => {
    tree.writeJson('package.json', { scripts: { build: ['compile'] } });

    expect(() => generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false)).toThrow('`scripts.build` must be a string');
  });

  it('includes usage line', () => {
    const help = generateHelp({}, NON_WORKSPACE_DIR, undefined, false);
    expect(help).toContain('Usage: nmr [flags] <command> [args...]');
  });

  it('includes all flag descriptions', () => {
    const help = generateHelp({}, NON_WORKSPACE_DIR, undefined, false);
    expect(help).toContain('-F, --filter');
    expect(help).toContain('-R, --recursive');
    expect(help).toContain('-w, --workspace-root');
    expect(help).toContain('--json');
    expect(help).toContain('--log');
    expect(help).toContain('--no-cache');
    expect(help).toContain('--output-style <style>');
    expect(help).toContain('-?, --help');
    expect(help).toContain('-V, --version');
    expect(help).toContain('NMR_OUTPUT_STYLE');
  });

  it('includes workspace commands section', () => {
    const help = generateHelp({}, NON_WORKSPACE_DIR, undefined, false);
    expect(help).toContain('Workspace commands:');
    expect(help).toContain('build');
    expect(help).toContain('test');
    expect(help).toContain('typecheck');
  });

  it('includes root commands section', () => {
    const help = generateHelp({}, NON_WORKSPACE_DIR, undefined, false);
    expect(help).toContain('Root commands:');
    expect(help).toContain('ci');
    expect(help).toContain('report-overrides');
  });

  it('includes config-defined scripts', () => {
    const help = generateHelp(
      {
        workspaceScripts: { 'copy-content': 'tsx scripts/copy-content.ts' },
        rootScripts: { 'demo:catwalk': 'pnpx http-server' },
      },
      NON_WORKSPACE_DIR,
      undefined,
      false,
    );

    expect(help).toContain('copy-content');
    expect(help).toContain('demo:catwalk');
  });

  it('omits config-defined hooks from the workspace section', () => {
    const help = generateHelp(
      {
        workspaceScripts: { 'build:pre': 'npx rdy compile' },
      },
      NON_WORKSPACE_DIR,
      undefined,
      false,
    );

    expect(help).not.toContain('build:pre');
    expect(help).not.toContain('npx rdy compile');
  });

  it('omits config-defined hooks from the root section', () => {
    const help = generateHelp(
      {
        rootScripts: { 'build:post': 'echo built' },
      },
      NON_WORKSPACE_DIR,
      undefined,
      true,
    );

    expect(help).not.toContain('build:post');
    expect(help).not.toContain('echo built');
  });

  it('omits the package scripts section when packageDir is undefined', () => {
    const help = generateHelp({}, NON_WORKSPACE_DIR, undefined, false);
    expect(help).not.toContain('Package scripts:');
  });

  describe('package.json scripts', () => {
    it('lists an unregistered workspace script under Package scripts with its command', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'pkg-with-extra',
        scripts: { 'custom-task': 'echo custom' },
      });

      const help = generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false);
      const packageSection = readSection(help, 'Package scripts:', '* Overridden by package.json');
      expect(readCommandNames(packageSection)).toStrictEqual(['custom-task']);
      expect(packageSection).toContain('echo custom');
      expect(help).not.toContain('* Overridden by package.json');
    });

    it('lists an unregistered root script under Package scripts in root context', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'root-with-extra',
        scripts: { bootstrap: 'pnpm run prepare' },
      });

      const help = generateHelp({}, NON_WORKSPACE_DIR, tree.dir, true);
      const packageSection = readSection(help, 'Package scripts:', '* Overridden by package.json');
      expect(readCommandNames(packageSection)).toStrictEqual(['bootstrap']);
      expect(packageSection).toContain('pnpm run prepare');
    });

    it('lists a hook that a package declares', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'pkg-with-hook',
        scripts: { 'build:pre': 'rdy verify' },
      });

      const packageSection = readSection(
        generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false),
        'Package scripts:',
        '* Overridden',
      );
      expect(readCommandNames(packageSection)).toStrictEqual(['build:pre']);
      expect(packageSection).toContain('rdy verify');
    });

    it('omits a package entry overriding a registry hook', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'pkg-overriding-hook',
        scripts: { 'build:pre': 'sentinel-hook-value' },
      });

      const help = generateHelp(
        { workspaceScripts: { 'build:pre': 'npx rdy compile' } },
        NON_WORKSPACE_DIR,
        tree.dir,
        false,
      );
      expect(help).not.toContain('Package scripts:');
      expect(help).not.toContain('sentinel-hook-value');
    });

    it('lists a script under Package scripts when only the inactive registry contains its name', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'pkg-with-root-name',
        scripts: { audit: 'sentinel-audit' },
      });

      const packageSection = readSection(
        generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false),
        'Package scripts:',
        '* Overridden',
      );
      expect(readCommandNames(packageSection)).toStrictEqual(['audit']);
    });

    it('omits generic pnpm lifecycle entries from a subpackage package.json', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'pkg-lifecycle',
        scripts: { prepare: 'echo prepare', postinstall: 'echo postinstall', prepublishOnly: 'echo publish' },
      });

      const help = generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false);
      expect(help).not.toContain('Package scripts:');
      expect(help).not.toContain('prepare');
      expect(help).not.toContain('postinstall');
      expect(help).not.toContain('prepublishOnly');
    });

    it('omits a self-referential entry that the registry does not contain', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'pkg-unregistered-self-ref',
        scripts: { 'custom-task': 'nmr custom-task' },
      });

      expect(generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false)).not.toContain('Package scripts:');
    });

    it('lists an override once, as its marked registry row', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'pkg-override-once',
        scripts: { lint: 'pkg-linter' },
      });

      const help = generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false);
      expect(help).not.toContain('Package scripts:');
      expect(help.split('pkg-linter')).toHaveLength(2);
    });

    // The registry is a plain object, so `'toString' in registry` is true and the entry would otherwise be written in
    // as though it were overriding a real command.
    it('lists an entry named for an `Object.prototype` member as an unregistered script', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'pkg-prototype-name',
        scripts: { toString: 'sentinel-prototype-value' },
      });

      const help = generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false);
      const packageSection = readSection(help, 'Package scripts:', '* Overridden by package.json');
      expect(readCommandNames(packageSection)).toStrictEqual(['toString']);
      expect(packageSection).toContain('sentinel-prototype-value');
      expect(help).not.toContain('toString*');
      expect(help).not.toContain('* Overridden by package.json');
    });

    it('inlines workspace overrides with `*` marker and footnote when shouldUseRoot=false', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'pkg-override',
        scripts: { lint: 'pkg-linter' },
      });

      const help = generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false);
      const workspaceSection = readSection(help, 'Workspace commands:', 'Root commands:');
      expect(workspaceSection).toContain('lint*');
      expect(workspaceSection).toContain('pkg-linter');
      expect(help).toContain('* Overridden by package.json');

      const rootSection = readSection(help, 'Root commands:', '* Overridden by package.json');
      expect(rootSection).not.toContain('pkg-linter');
    });

    it('inlines root overrides with `*` marker and footnote when shouldUseRoot=true', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'root-override',
        scripts: { lint: 'custom-linter' },
      });

      const help = generateHelp({}, NON_WORKSPACE_DIR, tree.dir, true);
      const rootSection = readSection(help, 'Root commands:', '* Overridden by package.json');
      expect(rootSection).toContain('lint*');
      expect(rootSection).toContain('custom-linter');
      expect(help).toContain('* Overridden by package.json');

      const workspaceSection = readSection(help, 'Workspace commands:', 'Root commands:');
      expect(workspaceSection).not.toContain('custom-linter');
    });

    it('does not mark or override self-referential entries', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'pkg-self-ref',
        scripts: { build: 'nmr build' },
      });

      const help = generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false);
      expect(help).not.toContain('build*');
      expect(help).not.toContain('* Overridden by package.json');
    });

    // Resolution discards the entry, so rendering it as the command's value would name something nmr never runs.
    it('does not mark or override an entry chaining steps onto a self-reference', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'pkg-chained-self-ref',
        scripts: { build: 'rdy compile && nmr build' },
      });

      const help = generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false);
      expect(help).not.toContain('build*');
      expect(help).not.toContain('rdy compile');
      expect(help).not.toContain('* Overridden by package.json');
    });

    it('omits the footnote when the package.json does not contain any overrides', ({ tree }) => {
      tree.writeJson('package.json', { name: 'plain-pkg' });

      const help = generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false);
      expect(help).not.toContain('* Overridden by package.json');
    });

    it('aligns the value column for marked and unmarked rows in the same section', ({ tree }) => {
      tree.writeJson('package.json', {
        name: 'align-pkg',
        scripts: { lint: 'custom-linter' },
      });

      const help = generateHelp({}, NON_WORKSPACE_DIR, tree.dir, true);
      const rootSection = readSection(help, 'Root commands:', '* Overridden by package.json');
      const rows = rootSection.split('\n').filter((line) => line.startsWith('  ') && line.trim().length > 0);
      const valueColumns = new Set(rows.map((line) => findValueColumn(line)));
      expect(valueColumns.size).toBe(1);
    });
  });

  describe('test commands', () => {
    it('lists all six test commands for every package', ({ tree }) => {
      const workspaceSection = readSection(
        generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false),
        'Workspace commands:',
        'Root commands:',
      );

      expect(readCommandNames(workspaceSection)).toStrictEqual(
        expect.arrayContaining(['test', 'test:all', 'test:coverage', 'test:tool', 'test:unit', 'test:watch']),
      );
      expect(workspaceSection).toContain('pnpm exec vitest --project unit --project tool');
    });

    // Help renders the registry, so an on-disk probe anywhere in resolution would change the listing here.
    it('lists the same commands when the retired variant config is present', ({ tree }) => {
      const bareSection = readSection(
        generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false),
        'Workspace commands:',
        'Root commands:',
      );
      tree.write('vitest.integration.config.ts', '');
      tree.write('vitest.standalone.config.ts', '');

      const withConfigsSection = readSection(
        generateHelp({}, NON_WORKSPACE_DIR, tree.dir, false),
        'Workspace commands:',
        'Root commands:',
      );

      expect(withConfigsSection).toBe(bareSection);
      expect(withConfigsSection).not.toContain('vitest.standalone.config.ts');
    });

    it('lists the root test selections in root context', ({ tree }) => {
      const rootSection = readSection(
        generateHelp({}, NON_WORKSPACE_DIR, tree.dir, true),
        'Root commands:',
        '* Overridden',
      );

      expect(readCommandNames(rootSection)).toStrictEqual(
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

    it('lists each root lint command with the workspaces that it excludes', () => {
      const root = buildMonorepo({
        'apps/web/package.json': '{ "name": "web" }\n',
        'packages/lib/package.json': '{ "name": "lib" }\n',
        'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n',
      });
      const exclusions = "--ignore-pattern 'apps/web/**' --ignore-pattern 'packages/lib/**' .";

      // The listing is the same whether nmr runs from the root or from inside a package.
      for (const [packageDir, shouldUseRoot] of [
        [root, true],
        [`${root}/apps/web`, false],
      ] as const) {
        const rootSection = readSection(
          generateHelp({}, root, packageDir, shouldUseRoot),
          'Root commands:',
          '* Overridden',
        );

        expect(rootSection).toContain(`eslint --fix ${exclusions}`);
        expect(rootSection).toContain(`eslint ${exclusions}`);
        expect(rootSection).toContain(`strict-lint ${exclusions}`);
      }
    });

    it('describes a delegating root selection as the steps that it runs', ({ tree }) => {
      const rootSection = readSection(
        generateHelp({}, NON_WORKSPACE_DIR, tree.dir, true),
        'Root commands:',
        '* Overridden',
      );

      expect(rootSection).toContain('[root:test, -R test]');
    });
  });
});

/**
 * Collects the command name from every rendered registry row in `section`, dropping the `*` override marker.
 * Names compare exactly, so a row is not satisfied by a longer sibling that merely contains it.
 */
function readCommandNames(section: string): string[] {
  return section
    .split('\n')
    .filter((line) => line.startsWith('  '))
    .map((line) => (line.trim().split(/\s+/, 1)[0] ?? '').replace(/\*$/, ''));
}

/**
 * Returns the part of `help` from `start` up to but not including `end`: the rest of `help` when `end` is absent,
 * and the empty string when `start` is absent.
 */
function readSection(help: string, start: string, end: string): string {
  const startIndex = help.indexOf(start);
  const endIndex = help.indexOf(end, startIndex + start.length);
  if (startIndex === -1) return '';
  if (endIndex === -1) return help.slice(startIndex);
  return help.slice(startIndex, endIndex);
}

/**
 * Returns the column index at which the value starts on a registry row.
 * A row looks like `  <key><marker>   <value>`; the value begins at the
 * first non-space character following the column padding after the key.
 */
function findValueColumn(line: string): number {
  let index = 2;
  while (index < line.length && line[index] !== ' ') index++;
  while (index < line.length && line[index] === ' ') index++;
  return index;
}
