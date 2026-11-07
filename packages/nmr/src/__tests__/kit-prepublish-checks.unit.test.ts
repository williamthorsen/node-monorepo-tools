import { describe, expect, it } from 'vitest';

import { everyPublishablePackageDeclaresPrepublishOnly } from '../../.readyup/lib/workspace-build.ts';
import { findKitCheck } from '../test-utils/findKitCheck.ts';
import { getDetail } from '../test-utils/getDetail.ts';
import { useMonorepo } from '../test-utils/useMonorepo.ts';

describe(everyPublishablePackageDeclaresPrepublishOnly, () => {
  it('is registered in the kit', () => {
    expect(findKitCheck('every publishable package declares prepublishOnly').check).toBe(
      everyPublishablePackageDeclaresPrepublishOnly,
    );
  });

  it('passes when every publishable package declares prepublishOnly', () => {
    useMonorepo({
      'packages/lib/package.json': renderManifest({ name: '@fixture/lib', scripts: { prepublishOnly: 'nmr build' } }),
    });

    expect(everyPublishablePackageDeclaresPrepublishOnly()).toBe(true);
  });

  it('passes over a private package that does not declare prepublishOnly', () => {
    useMonorepo({
      'packages/app/package.json': renderManifest({ name: '@fixture/app', private: true }),
    });

    expect(everyPublishablePackageDeclaresPrepublishOnly()).toBe(true);
  });

  it('lists each publishable package that does not declare prepublishOnly', () => {
    useMonorepo({
      'packages/a/package.json': renderManifest({ name: '@fixture/a' }),
      'packages/b/package.json': renderManifest({ name: '@fixture/b', scripts: { build: ':' } }),
      'packages/c/package.json': renderManifest({ name: '@fixture/c', scripts: { prepublishOnly: 'nmr build' } }),
    });

    const detail = getDetail(everyPublishablePackageDeclaresPrepublishOnly());
    expect(detail).toContain('2 found:');
    expect(detail).toContain('@fixture/a');
    expect(detail).toContain('@fixture/b');
    expect(detail).not.toContain('@fixture/c');
  });

  it('fails with the reason when a manifest is invalid', () => {
    useMonorepo({ 'packages/broken/package.json': '{ not json' });

    expect(getDetail(everyPublishablePackageDeclaresPrepublishOnly())).toContain('package.json');
  });
});

// region | Helpers

/** Renders a workspace manifest from the given fields. */
function renderManifest(fields: Record<string, unknown>): string {
  return `${JSON.stringify(fields, undefined, 2)}\n`;
}

// endregion | Helpers
