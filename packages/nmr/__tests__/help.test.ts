import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateHelp } from '../src/help.js';

describe(generateHelp, () => {
  it('includes usage line', () => {
    const help = generateHelp({});
    expect(help).toContain('Usage: nmr [flags] <command> [args...]');
  });

  it('includes all flag descriptions', () => {
    const help = generateHelp({});
    expect(help).toContain('-F, --filter');
    expect(help).toContain('-R, --recursive');
    expect(help).toContain('-w, --workspace-root');
    expect(help).toContain('-?, --help');
    expect(help).toContain('--int-test');
  });

  it('includes workspace commands section', () => {
    const help = generateHelp({});
    expect(help).toContain('Workspace commands:');
    expect(help).toContain('build');
    expect(help).toContain('test');
    expect(help).toContain('typecheck');
  });

  it('includes root commands section', () => {
    const help = generateHelp({});
    expect(help).toContain('Root commands:');
    expect(help).toContain('ci');
    expect(help).toContain('report-overrides');
  });

  it('includes config-defined scripts', () => {
    const help = generateHelp({
      workspaceScripts: { 'copy-content': 'tsx scripts/copy-content.ts' },
      rootScripts: { 'demo:catwalk': 'pnpx http-server' },
    });

    expect(help).toContain('copy-content');
    expect(help).toContain('demo:catwalk');
  });

  it('includes config-defined hook in workspace commands', () => {
    const help = generateHelp({
      workspaceScripts: { 'build:pre': 'npx rdy compile' },
    });

    expect(help).toContain('build:pre');
    expect(help).toContain('npx rdy compile');
  });

  describe('package scripts section', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-help-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('omits package scripts section when packageDir is not provided', () => {
      const help = generateHelp({});
      expect(help).not.toContain('Package scripts:');
    });

    it('omits package scripts section when package has no scripts', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'empty-pkg' }));

      const help = generateHelp({}, tmpDir);
      expect(help).not.toContain('Package scripts:');
    });

    it('lists tier-3 hook scripts in package scripts section', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'pkg-with-hook',
          scripts: { 'build:post': 'nmr-sync-agent-files' },
        }),
      );

      const help = generateHelp({}, tmpDir);
      expect(help).toContain('Package scripts:');
      expect(help).toContain('build:post');
      expect(help).toContain('nmr-sync-agent-files');
    });

    it('lists tier-3 non-hook overrides in package scripts section', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'pkg-with-override',
          scripts: { build: 'tsc -p tsconfig.custom.json' },
        }),
      );

      const help = generateHelp({}, tmpDir);
      expect(help).toContain('Package scripts:');
      expect(help).toContain('tsc -p tsconfig.custom.json');
    });

    it('omits self-referential package scripts', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'pkg-self-ref',
          scripts: {
            build: 'nmr build',
            'build:post': 'nmr-sync-agent-files',
          },
        }),
      );

      const help = generateHelp({}, tmpDir);
      expect(help).toContain('Package scripts:');
      expect(help).toContain('build:post');
      // The self-referential `"build": "nmr build"` should not appear as a package script
      const packageSection = help.slice(help.indexOf('Package scripts:'));
      expect(packageSection).not.toContain('nmr build\n');
    });
  });
});
