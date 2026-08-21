import type { TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { disposeOnTestFinished, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { reportOverrides } from '../report-overrides.ts';

describe(reportOverrides, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-report-test-' }));
  });

  it('does nothing when no overrides exist', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });

    using silent = silenceConsole(['warn']);
    reportOverrides(tree.dir);

    expect(silent.warn).not.toHaveBeenCalled();
  });

  it('reports the overrides declared in pnpm-workspace.yaml', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });
    writeWorkspaceManifest('overrides:\n  some-package: 1.2.3\n');

    using silent = silenceConsole(['warn']);
    reportOverrides(tree.dir);

    expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('pnpm overrides are active'));
    expect(silent.warn).toHaveBeenCalledWith('- some-package → 1.2.3');
    expect(silent.warn).toHaveBeenCalledWith('\n🔒 1 override is active. Check whether it is still needed.');
  });

  it('closes the report with the count of overrides it named', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });
    writeWorkspaceManifest('overrides:\n  some-package: 1.2.3\n  other-package: 4.5.6\n');

    using silent = silenceConsole(['warn']);
    reportOverrides(tree.dir);

    expect(silent.warn).toHaveBeenCalledWith('\n🔒 2 overrides are active. Check whether they are still needed.');
  });

  // YAML's implicit typing turns an unquoted version into a number, which must not cost the entries beside it.
  it('keeps the string entries of a workspace block carrying a non-string value', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });
    writeWorkspaceManifest('overrides:\n  react: 18\n  node-fetch: 2.6.7\n');

    using silent = silenceConsole(['warn']);
    reportOverrides(tree.dir);

    expect(silent.warn).toHaveBeenCalledWith('- node-fetch → 2.6.7');
    expect(silent.warn).not.toHaveBeenCalledWith(expect.stringContaining('react'));
  });

  it('does nothing when the workspace overrides block is empty', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });
    writeWorkspaceManifest('packages:\n  - packages/*\n');

    using silent = silenceConsole(['warn']);
    reportOverrides(tree.dir);

    expect(silent.warn).not.toHaveBeenCalled();
  });

  it('rejects a pnpm.overrides block, naming every entry and the remedy', () => {
    writePackageJson({
      name: 'test',
      version: '1.0.0',
      pnpm: { overrides: { 'some-package': '1.2.3', 'other-package': '4.5.6' } },
    });

    using _silent = silenceConsole(['warn']);

    expect(() => reportOverrides(tree.dir)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('- some-package → 1.2.3'),
        name: 'UserError',
      }),
    );
    expect(() => reportOverrides(tree.dir)).toThrow(/other-package → 4\.5\.6/);
    expect(() => reportOverrides(tree.dir)).toThrow(/pnpm-workspace\.yaml/);
  });

  // The gate proves the block absent, so a value it cannot render is still a key the user has to move.
  it('rejects a pnpm.overrides block carrying a non-string value, naming that entry', () => {
    writePackageJson({
      name: 'test',
      version: '1.0.0',
      pnpm: { overrides: { react: 18 } },
    });

    using _silent = silenceConsole(['warn']);

    expect(() => reportOverrides(tree.dir)).toThrow(/react → 18/);
  });

  it('accepts an empty pnpm.overrides block', () => {
    writePackageJson({ name: 'test', version: '1.0.0', pnpm: { overrides: {} } });

    using silent = silenceConsole(['warn']);
    reportOverrides(tree.dir);

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

    expect(() => reportOverrides(tree.dir)).toThrow(/legacy-package/);
    expect(silent.warn).toHaveBeenCalledWith('- current-package → 2.0.0');
  });

  // region | Helpers

  /** Writes the monorepo root's `package.json`. */
  function writePackageJson(pkg: Record<string, unknown>): void {
    tree.write('package.json', JSON.stringify(pkg));
  }

  /** Writes the monorepo root's `pnpm-workspace.yaml`. */
  function writeWorkspaceManifest(content: string): void {
    tree.write('pnpm-workspace.yaml', content);
  }

  // endregion | Helpers
});
