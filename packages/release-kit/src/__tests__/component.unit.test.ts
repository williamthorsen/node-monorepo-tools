import { describe, expect, it } from 'vitest';

import { component } from '../component.ts';

describe(component, () => {
  it('derives all fields from the workspace path', () => {
    expect(component('packages/basic')).toStrictEqual({
      dir: 'basic',
      tagPrefix: 'basic-v',
      packageFiles: ['packages/basic/package.json'],
      changelogPaths: ['packages/basic'],
      paths: ['packages/basic/**'],
    });
  });

  it('works with non-standard workspace paths', () => {
    expect(component('libs/core')).toStrictEqual({
      dir: 'core',
      tagPrefix: 'core-v',
      packageFiles: ['libs/core/package.json'],
      changelogPaths: ['libs/core'],
      paths: ['libs/core/**'],
    });
  });
});
