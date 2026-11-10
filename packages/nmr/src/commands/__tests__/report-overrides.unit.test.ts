import { captureStdio, createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { reportOverrides, runReportOverrides } from '../report-overrides.ts';

describe(reportOverrides, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-report-test-' }));
  });

  it('does nothing when the repo does not declare any overrides', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });

    using silent = silenceConsole(['warn']);
    reportOverrides(tree.dir, 'rich');

    expect(silent.warn).not.toHaveBeenCalled();
  });

  it('reports the overrides declared in pnpm-workspace.yaml', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });
    writeWorkspaceManifest('overrides:\n  some-package: 1.2.3\n');

    using silent = silenceConsole(['warn']);
    reportOverrides(tree.dir, 'rich');

    expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('pnpm overrides are active'));
    expect(silent.warn).toHaveBeenCalledWith('- some-package → 1.2.3');
    expect(silent.warn).toHaveBeenCalledWith('\n🔒 1 override is active. Check whether it is still needed.');
  });

  it('drops the glyph in a plain run and keeps the text after it', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });
    writeWorkspaceManifest('overrides:\n  some-package: 1.2.3\n');

    using silent = silenceConsole(['warn']);
    reportOverrides(tree.dir, 'plain');

    expect(silent.warn).toHaveBeenCalledWith('WARN: pnpm overrides are active:');
    expect(silent.warn).toHaveBeenCalledWith('\n1 override is active. Check whether it is still needed.');
  });

  it('closes the report with the count of overrides that it named', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });
    writeWorkspaceManifest('overrides:\n  some-package: 1.2.3\n  other-package: 4.5.6\n');

    using silent = silenceConsole(['warn']);
    reportOverrides(tree.dir, 'rich');

    expect(silent.warn).toHaveBeenCalledWith('\n🔒 2 overrides are active. Check whether they are still needed.');
  });

  // YAML's implicit typing turns an unquoted version into a number, which must not cause the entries beside it to be
  // dropped.
  it('keeps the string entries of a workspace block containing a non-string value', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });
    writeWorkspaceManifest('overrides:\n  react: 18\n  node-fetch: 2.6.7\n');

    using silent = silenceConsole(['warn']);
    reportOverrides(tree.dir, 'rich');

    expect(silent.warn).toHaveBeenCalledWith('- node-fetch → 2.6.7');
    expect(silent.warn).not.toHaveBeenCalledWith(expect.stringContaining('react'));
  });

  it('does nothing when the workspace overrides block is empty', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });
    writeWorkspaceManifest('packages:\n  - packages/*\n');

    using silent = silenceConsole(['warn']);
    reportOverrides(tree.dir, 'rich');

    expect(silent.warn).not.toHaveBeenCalled();
  });

  it('rejects a pnpm.overrides block, naming every entry and the remedy', () => {
    writePackageJson({
      name: 'test',
      version: '1.0.0',
      pnpm: { overrides: { 'some-package': '1.2.3', 'other-package': '4.5.6' } },
    });

    using _silent = silenceConsole(['warn']);

    expect(() => reportOverrides(tree.dir, 'rich')).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('- some-package → 1.2.3'),
        name: 'UserError',
      }),
    );
    expect(() => reportOverrides(tree.dir, 'rich')).toThrow(/other-package → 4\.5\.6/);
    expect(() => reportOverrides(tree.dir, 'rich')).toThrow(/pnpm-workspace\.yaml/);
  });

  // The gate proves the block absent, so a value that it cannot render is still a key for the user to move.
  it('rejects a pnpm.overrides block containing a non-string value, naming that entry', () => {
    writePackageJson({
      name: 'test',
      version: '1.0.0',
      pnpm: { overrides: { react: 18 } },
    });

    using _silent = silenceConsole(['warn']);

    expect(() => reportOverrides(tree.dir, 'rich')).toThrow(/react → 18/);
  });

  it('accepts an empty pnpm.overrides block', () => {
    writePackageJson({ name: 'test', version: '1.0.0', pnpm: { overrides: {} } });

    using silent = silenceConsole(['warn']);
    reportOverrides(tree.dir, 'rich');

    expect(silent.warn).not.toHaveBeenCalled();
  });

  it('reports the supported site before rejecting the legacy one', () => {
    writePackageJson({
      name: 'test',
      version: '1.0.0',
      pnpm: { overrides: { 'legacy-package': '0.1.0' } },
    });
    writeWorkspaceManifest('overrides:\n  current-package: 2.0.0\n');

    using silent = silenceConsole(['warn']);

    expect(() => reportOverrides(tree.dir, 'rich')).toThrow(/legacy-package/);
    expect(silent.warn).toHaveBeenCalledWith('- current-package → 2.0.0');
  });

  // region | Helpers

  /** Writes the monorepo root's `package.json`. */
  function writePackageJson(packageJson: Record<string, unknown>): void {
    tree.write('package.json', JSON.stringify(packageJson));
  }

  /** Writes the monorepo root's `pnpm-workspace.yaml`. */
  function writeWorkspaceManifest(content: string): void {
    tree.write('pnpm-workspace.yaml', content);
  }

  // endregion | Helpers
});

describe(runReportOverrides, () => {
  let tree: TempTree;

  beforeEach(() => {
    // A declared override, so that a run which reached the report would print it.
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-report-overrides-argv-test-' }));
    tree.write('package.json', JSON.stringify({ name: 'test', version: '1.0.0' }));
    tree.write('pnpm-workspace.yaml', 'overrides:\n  some-package: 1.2.3\n');
  });

  it.for(['--help', '-h'])('answers %s with help and does not report', async (flag) => {
    using captured = captureStdio();

    await expect(runReportOverrides([flag], tree.dir)).resolves.toBe(0);

    expect(captured.stdout).toContain('Usage: nmr-report-overrides');
    expect(captured.stderr).toBe('');
  });

  it.for(['--bogus', 'packages'])('rejects %s as a usage error and does not report', async (argument) => {
    using captured = captureStdio();

    await expect(runReportOverrides([argument], tree.dir)).resolves.toBe(2);

    expect(captured.stderr).not.toContain('some-package');
    expect(captured.stderr).toContain("Try 'nmr-report-overrides --help'.");
  });

  it('reports the overrides of the monorepo containing the directory when given no arguments', async () => {
    const packageDir = tree.mkdir('packages/a');
    using silent = silenceConsole(['warn']);

    await expect(runReportOverrides([], packageDir)).resolves.toBe(0);

    expect(silent.warn).toHaveBeenCalledWith('- some-package → 1.2.3');
  });

  it('lets a legacy overrides block fail past the parser rather than as a usage error', async () => {
    tree.write('package.json', JSON.stringify({ name: 'test', pnpm: { overrides: { 'legacy-package': '0.1.0' } } }));
    using _silent = silenceConsole(['warn']);

    await expect(runReportOverrides([], tree.dir)).rejects.toThrow(/legacy-package/);
  });
});
