import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { NMR_PACKAGE_DIR } from '../../test-utils/nmr-bin-harness.ts';

const HELPER_URL = pathToFileURL(path.join(NMR_PACKAGE_DIR, 'dist', 'esm', 'helpers', 'importConfigDefault.js')).href;

const UNTERMINATED_CONFIG = `const unused = 1;\nexport default { delegate: false\n`;

const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({ 'real/config.ts': UNTERMINATED_CONFIG }, { prefix: 'nmr-import-config-' })),
);

// Node's own loader, which Vitest replaces in-process, is what names the line of a parse error.
describe('importConfigDefault under Node', () => {
  it('names the line of a config that fails to parse', ({ tree }) => {
    const configPath = tree.resolve('real/config.ts');

    expect(readLoadErrorMessage(configPath)).toMatch(
      new RegExp(
        String.raw`^Cannot load nmr config at ${escapeRegExp(configPath)}:2: .+\. Fix the file and rerun\.$`,
        'u',
      ),
    );
  });

  it('names the line of a config reached through a symlinked directory', ({ tree }) => {
    tree.symlink('linked', tree.resolve('real'));
    const linkedPath = tree.resolve('linked/config.ts');

    expect(readLoadErrorMessage(linkedPath)).toMatch(
      new RegExp(`^Cannot load nmr config at ${escapeRegExp(linkedPath)}:2: `, 'u'),
    );
  });
});

// region | Helpers

/** Escapes the characters that a regular expression reads as syntax. */
function escapeRegExp(text: string): string {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);
}

/** Imports the config at `configPath` through the built helper in a `node` subprocess and returns the error's message. */
function readLoadErrorMessage(configPath: string): string {
  const script = `
    const { importConfigDefault } = await import(${JSON.stringify(HELPER_URL)});
    await importConfigDefault(${JSON.stringify(configPath)}).then(
      () => process.stdout.write('loaded'),
      (error) => process.stdout.write(error.message),
    );
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    stdio: 'pipe',
  });

  expect(result.stderr).toBe('');
  return result.stdout;
}

// endregion | Helpers
