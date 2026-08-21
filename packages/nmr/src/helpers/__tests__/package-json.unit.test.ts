import type { TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { UserError } from '../../UserError.ts';
import { readPackageJson } from '../package-json.ts';

describe(readPackageJson, () => {
  let tree: TempTree;

  function writeManifest(content: unknown): void {
    tree.write('package.json', JSON.stringify(content));
  }

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-pkgjson-' }));
  });

  it('parses the fields nmr reads', () => {
    writeManifest({
      name: 'p',
      private: true,
      version: '1.2.3',
      packageManager: 'pnpm@10.34.4',
      scripts: { build: 'tsc' },
      pnpm: { overrides: { lodash: '4.17.21' } },
    });

    expect(readPackageJson(tree.dir)).toStrictEqual({
      name: 'p',
      private: true,
      version: '1.2.3',
      packageManager: 'pnpm@10.34.4',
      scripts: { build: 'tsc' },
      pnpm: { overrides: { lodash: '4.17.21' } },
    });
  });

  it('omits fields the manifest does not declare', () => {
    writeManifest({ name: 'p' });

    expect(readPackageJson(tree.dir)).toStrictEqual({ name: 'p' });
  });

  it('omits a field whose value is of the wrong type', () => {
    writeManifest({ name: 42, version: '1.0.0' });

    expect(readPackageJson(tree.dir)).toStrictEqual({ version: '1.0.0' });
  });

  it('rejects a non-string script rather than dropping it', () => {
    writeManifest({ scripts: { build: 'tsc', broken: 7 } });

    expect(() => readPackageJson(tree.dir)).toThrow('`scripts.broken` must be a string');
  });

  it('names the config field a step list belongs in', () => {
    writeManifest({ scripts: { build: ['compile'] } });

    expect(() => readPackageJson(tree.dir)).toThrow('under `workspaceScripts`');
  });

  it('rejects a manifest that does not parse, naming the file', () => {
    tree.write('package.json', '{ not json');

    expect(() => readPackageJson(tree.dir)).toThrow(UserError);
    expect(() => readPackageJson(tree.dir)).toThrow(tree.resolve('package.json'));
  });

  it('treats "private": false as not private', () => {
    writeManifest({ name: 'p', private: false });

    expect(readPackageJson(tree.dir)).toStrictEqual({ name: 'p' });
  });

  it('throws when the manifest is not an object', () => {
    tree.write('package.json', '"not an object"');

    expect(() => readPackageJson(tree.dir)).toThrow(UserError);
  });

  it('throws when the manifest is not valid JSON', () => {
    tree.write('package.json', '{ not json');

    expect(() => readPackageJson(tree.dir)).toThrow(/Expected property name/);
  });
});
