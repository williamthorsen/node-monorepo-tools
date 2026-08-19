import fs from 'node:fs';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, test } from 'vitest';

import { generateHelp } from '../help.ts';

const it = test.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-help-test-' })),
);

describe(generateHelp, () => {
  // The listing reads the same tier-3 scripts resolution does, so a malformed entry stops it rather than being
  // omitted from a help text that looks complete.
  it('rejects a malformed package.json script rather than omitting it', () => {
    using tree = createTempTree({}, { prefix: 'nmr-help-' });
    fs.writeFileSync(path.join(tree.dir, 'package.json'), JSON.stringify({ scripts: { build: ['compile'] } }));

    expect(() => generateHelp({}, tree.dir, false)).toThrow('`scripts.build` must be a string');
  });

  it('includes usage line', () => {
    const help = generateHelp({}, undefined, false);
    expect(help).toContain('Usage: nmr [flags] <command> [args...]');
  });

  it('includes all flag descriptions', () => {
    const help = generateHelp({}, undefined, false);
    expect(help).toContain('-F, --filter');
    expect(help).toContain('-R, --recursive');
    expect(help).toContain('-w, --workspace-root');
    expect(help).toContain('--json');
    expect(help).toContain('--log');
    expect(help).toContain('--no-cache');
    expect(help).toContain('-?, --help');
    expect(help).toContain('-V, --version');
  });

  it('includes workspace commands section', () => {
    const help = generateHelp({}, undefined, false);
    expect(help).toContain('Workspace commands:');
    expect(help).toContain('build');
    expect(help).toContain('test');
    expect(help).toContain('typecheck');
  });

  it('includes root commands section', () => {
    const help = generateHelp({}, undefined, false);
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
      undefined,
      true,
    );

    expect(help).not.toContain('build:post');
    expect(help).not.toContain('echo built');
  });

  it('omits the package scripts section regardless of packageDir', () => {
    const help = generateHelp({}, undefined, false);
    expect(help).not.toContain('Package scripts:');
  });

  describe('overrides section behavior', () => {
    it('omits the package scripts section even when packageDir has scripts', ({ tree }) => {
      fs.writeFileSync(
        path.join(tree.dir, 'package.json'),
        JSON.stringify({
          name: 'pkg',
          scripts: { something: 'echo something' },
        }),
      );

      const help = generateHelp({}, tree.dir, false);
      expect(help).not.toContain('Package scripts:');
    });

    it('omits hook entries from a subpackage package.json', ({ tree }) => {
      // Use a sentinel value that is not present in any default registry entry,
      // so we can detect leakage of the package-script value distinctly from
      // unrelated registry rows.
      fs.writeFileSync(
        path.join(tree.dir, 'package.json'),
        JSON.stringify({
          name: 'pkg-with-hook',
          scripts: { 'build:post': 'sentinel-hook-value' },
        }),
      );

      const help = generateHelp({}, tree.dir, false);
      expect(help).not.toContain('build:post');
      expect(help).not.toContain('sentinel-hook-value');
    });

    it('omits non-override (tier-3-only) entries from a subpackage package.json', ({ tree }) => {
      fs.writeFileSync(
        path.join(tree.dir, 'package.json'),
        JSON.stringify({
          name: 'pkg-with-extra',
          scripts: { 'custom-task': 'echo custom' },
        }),
      );

      const help = generateHelp({}, tree.dir, false);
      expect(help).not.toContain('custom-task');
      expect(help).not.toContain('echo custom');
    });

    it('omits generic pnpm lifecycle entries from a subpackage package.json', ({ tree }) => {
      fs.writeFileSync(
        path.join(tree.dir, 'package.json'),
        JSON.stringify({
          name: 'pkg-lifecycle',
          scripts: { prepare: 'echo prepare', postinstall: 'echo postinstall' },
        }),
      );

      const help = generateHelp({}, tree.dir, false);
      expect(help).not.toContain('prepare');
      expect(help).not.toContain('postinstall');
    });

    it('omits an override named for an `Object.prototype` member', ({ tree }) => {
      // The registry is a plain object, so `'toString' in registry` is true and the override would be written in
      // as though it were overriding a real command.
      fs.writeFileSync(
        path.join(tree.dir, 'package.json'),
        JSON.stringify({
          name: 'pkg-prototype-name',
          scripts: { toString: 'sentinel-prototype-value' },
        }),
      );

      const help = generateHelp({}, tree.dir, false);
      expect(help).not.toContain('toString');
      expect(help).not.toContain('sentinel-prototype-value');
      expect(help).not.toContain('* Overridden by package.json');
    });

    it('inlines workspace overrides with `*` marker and footnote when useRoot=false', ({ tree }) => {
      fs.writeFileSync(
        path.join(tree.dir, 'package.json'),
        JSON.stringify({
          name: 'pkg-override',
          scripts: { lint: 'pkg-linter' },
        }),
      );

      const help = generateHelp({}, tree.dir, false);
      const workspaceSection = sectionOf(help, 'Workspace commands:', 'Root commands:');
      expect(workspaceSection).toContain('lint*');
      expect(workspaceSection).toContain('pkg-linter');
      expect(help).toContain('* Overridden by package.json');

      const rootSection = sectionOf(help, 'Root commands:', '* Overridden by package.json');
      expect(rootSection).not.toContain('pkg-linter');
    });

    it('inlines root overrides with `*` marker and footnote when useRoot=true', ({ tree }) => {
      fs.writeFileSync(
        path.join(tree.dir, 'package.json'),
        JSON.stringify({
          name: 'root-override',
          scripts: { lint: 'custom-linter' },
        }),
      );

      const help = generateHelp({}, tree.dir, true);
      const rootSection = sectionOf(help, 'Root commands:', '* Overridden by package.json');
      expect(rootSection).toContain('lint*');
      expect(rootSection).toContain('custom-linter');
      expect(help).toContain('* Overridden by package.json');

      const workspaceSection = sectionOf(help, 'Workspace commands:', 'Root commands:');
      expect(workspaceSection).not.toContain('custom-linter');
    });

    it('does not mark or override self-referential entries', ({ tree }) => {
      fs.writeFileSync(
        path.join(tree.dir, 'package.json'),
        JSON.stringify({
          name: 'pkg-self-ref',
          scripts: { build: 'nmr build' },
        }),
      );

      const help = generateHelp({}, tree.dir, false);
      expect(help).not.toContain('build*');
      expect(help).not.toContain('* Overridden by package.json');
    });

    // Resolution discards the entry, so rendering it as the command's value would name something nmr never runs.
    it('does not mark or override an entry chaining steps onto a self-reference', ({ tree }) => {
      fs.writeFileSync(
        path.join(tree.dir, 'package.json'),
        JSON.stringify({
          name: 'pkg-chained-self-ref',
          scripts: { build: 'rdy compile && nmr build' },
        }),
      );

      const help = generateHelp({}, tree.dir, false);
      expect(help).not.toContain('build*');
      expect(help).not.toContain('rdy compile');
      expect(help).not.toContain('* Overridden by package.json');
    });

    it('omits the footnote when no overrides are present', ({ tree }) => {
      fs.writeFileSync(path.join(tree.dir, 'package.json'), JSON.stringify({ name: 'plain-pkg' }));

      const help = generateHelp({}, tree.dir, false);
      expect(help).not.toContain('* Overridden by package.json');
    });

    it('aligns the value column for marked and unmarked rows in the same section', ({ tree }) => {
      fs.writeFileSync(
        path.join(tree.dir, 'package.json'),
        JSON.stringify({
          name: 'align-pkg',
          scripts: { lint: 'custom-linter' },
        }),
      );

      const help = generateHelp({}, tree.dir, true);
      const rootSection = sectionOf(help, 'Root commands:', '* Overridden by package.json');
      const rows = rootSection.split('\n').filter((line) => line.startsWith('  ') && line.trim().length > 0);
      // All rendered rows in the root section should share the same value-column offset
      const valueColumns = new Set(rows.map((line) => findValueColumn(line)));
      expect(valueColumns.size).toBe(1);
    });
  });

  describe('test commands', () => {
    it('lists all six test commands for every package', ({ tree }) => {
      const workspaceSection = sectionOf(generateHelp({}, tree.dir, false), 'Workspace commands:', 'Root commands:');

      expect(commandNamesIn(workspaceSection)).toStrictEqual(
        expect.arrayContaining(['test', 'test:all', 'test:coverage', 'test:tool', 'test:unit', 'test:watch']),
      );
      expect(workspaceSection).toContain('pnpm exec vitest --project unit --project tool');
    });

    // Help renders the registry, so a probe reintroduced anywhere would show up as a different listing here.
    it('lists the same commands when the retired variant config is present', ({ tree }) => {
      const bare = sectionOf(generateHelp({}, tree.dir, false), 'Workspace commands:', 'Root commands:');
      fs.writeFileSync(path.join(tree.dir, 'vitest.integration.config.ts'), '');
      fs.writeFileSync(path.join(tree.dir, 'vitest.standalone.config.ts'), '');

      const withConfigs = sectionOf(generateHelp({}, tree.dir, false), 'Workspace commands:', 'Root commands:');

      expect(withConfigs).toBe(bare);
      expect(withConfigs).not.toContain('vitest.standalone.config.ts');
    });

    it('lists the root test selections in root context', ({ tree }) => {
      const rootSection = sectionOf(generateHelp({}, tree.dir, true), 'Root commands:', '* Overridden');

      expect(commandNamesIn(rootSection)).toStrictEqual(
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

    it('describes a delegating root selection as the steps it runs', ({ tree }) => {
      const rootSection = sectionOf(generateHelp({}, tree.dir, true), 'Root commands:', '* Overridden');

      expect(rootSection).toContain('[root:test, -R test]');
    });
  });
});

/**
 * Collects the command name from every rendered registry row in `section`, dropping the `*` override marker.
 * Names compare exactly, so a row is not satisfied by a longer sibling that merely contains it.
 */
function commandNamesIn(section: string): string[] {
  return section
    .split('\n')
    .filter((line) => line.startsWith('  '))
    .map((line) => (line.trim().split(/\s+/, 1)[0] ?? '').replace(/\*$/, ''));
}

/**
 * Extracts the substring between two markers (exclusive of the end marker).
 * Returns the portion of `help` from `start` up to (but not including) `end`.
 */
function sectionOf(help: string, start: string, end: string): string {
  const startIdx = help.indexOf(start);
  const endIdx = help.indexOf(end, startIdx + start.length);
  if (startIdx === -1) return '';
  if (endIdx === -1) return help.slice(startIdx);
  return help.slice(startIdx, endIdx);
}

/**
 * Returns the column index where the value starts on a registry row.
 * A row looks like `  <key><marker>   <value>`; the value begins at the
 * first non-space character following the column padding after the key.
 */
function findValueColumn(line: string): number {
  // Skip the leading `  ` indent, then skip past the key+marker text, then
  // find the next non-space character which is where the value starts.
  let i = 2;
  while (i < line.length && line[i] !== ' ') i++;
  while (i < line.length && line[i] === ' ') i++;
  return i;
}
