import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateHelp } from '../src/help.js';

describe(generateHelp, () => {
  it('includes usage line', () => {
    const help = generateHelp({}, undefined, false);
    expect(help).toContain('Usage: nmr [flags] <command> [args...]');
  });

  it('includes all flag descriptions', () => {
    const help = generateHelp({}, undefined, false);
    expect(help).toContain('-F, --filter');
    expect(help).toContain('-R, --recursive');
    expect(help).toContain('-w, --workspace-root');
    expect(help).toContain('-?, --help');
    expect(help).toContain('--int-test');
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
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-help-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('omits the package scripts section even when packageDir has scripts', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'pkg',
          scripts: { something: 'echo something' },
        }),
      );

      const help = generateHelp({}, tmpDir, false);
      expect(help).not.toContain('Package scripts:');
    });

    it('omits hook entries from a subpackage package.json', () => {
      // Use a sentinel value that is not present in any default registry entry,
      // so we can detect leakage of the package-script value distinctly from
      // unrelated registry rows.
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'pkg-with-hook',
          scripts: { 'build:post': 'sentinel-hook-value' },
        }),
      );

      const help = generateHelp({}, tmpDir, false);
      expect(help).not.toContain('build:post');
      expect(help).not.toContain('sentinel-hook-value');
    });

    it('omits non-override (tier-3-only) entries from a subpackage package.json', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'pkg-with-extra',
          scripts: { 'custom-task': 'echo custom' },
        }),
      );

      const help = generateHelp({}, tmpDir, false);
      expect(help).not.toContain('custom-task');
      expect(help).not.toContain('echo custom');
    });

    it('omits generic pnpm lifecycle entries from a subpackage package.json', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'pkg-lifecycle',
          scripts: { prepare: 'echo prepare', postinstall: 'echo postinstall' },
        }),
      );

      const help = generateHelp({}, tmpDir, false);
      expect(help).not.toContain('prepare');
      expect(help).not.toContain('postinstall');
    });

    it('inlines workspace overrides with `*` marker and footnote when useRoot=false', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'pkg-override',
          scripts: { lint: 'pkg-linter' },
        }),
      );

      const help = generateHelp({}, tmpDir, false);
      const workspaceSection = sectionOf(help, 'Workspace commands:', 'Root commands:');
      expect(workspaceSection).toContain('lint*');
      expect(workspaceSection).toContain('pkg-linter');
      expect(help).toContain('* Overridden by package.json');

      const rootSection = sectionOf(help, 'Root commands:', '* Overridden by package.json');
      expect(rootSection).not.toContain('pkg-linter');
    });

    it('inlines root overrides with `*` marker and footnote when useRoot=true', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'root-override',
          scripts: { lint: 'custom-linter' },
        }),
      );

      const help = generateHelp({}, tmpDir, true);
      const rootSection = sectionOf(help, 'Root commands:', '* Overridden by package.json');
      expect(rootSection).toContain('lint*');
      expect(rootSection).toContain('custom-linter');
      expect(help).toContain('* Overridden by package.json');

      const workspaceSection = sectionOf(help, 'Workspace commands:', 'Root commands:');
      expect(workspaceSection).not.toContain('custom-linter');
    });

    it('does not mark or override self-referential entries', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'pkg-self-ref',
          scripts: { build: 'nmr build' },
        }),
      );

      const help = generateHelp({}, tmpDir, false);
      expect(help).not.toContain('build*');
      expect(help).not.toContain('* Overridden by package.json');
    });

    it('omits the footnote when no overrides are present', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'plain-pkg' }));

      const help = generateHelp({}, tmpDir, false);
      expect(help).not.toContain('* Overridden by package.json');
    });

    it('aligns the value column for marked and unmarked rows in the same section', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'align-pkg',
          scripts: { lint: 'custom-linter' },
        }),
      );

      const help = generateHelp({}, tmpDir, true);
      const rootSection = sectionOf(help, 'Root commands:', '* Overridden by package.json');
      const rows = rootSection.split('\n').filter((line) => line.startsWith('  ') && line.trim().length > 0);
      // All rendered rows in the root section should share the same value-column offset
      const valueColumns = new Set(rows.map((line) => findValueColumn(line)));
      expect(valueColumns.size).toBe(1);
    });
  });
});

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
