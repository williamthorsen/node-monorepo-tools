import { describe, expect, it } from 'vitest';

import { noUnguardedLefthookInstall } from '../../.readyup/kits/default.ts';
import { buildRepo } from '../test-utils/fixture-repo.ts';
import { getDetail } from '../test-utils/getDetail.ts';

describe(noUnguardedLefthookInstall, () => {
  it.each(['preinstall', 'install', 'postinstall', 'prepare'])(
    'reports an unguarded lefthook install in %s',
    (name) => {
      const dir = buildRepo({ 'package.json': buildManifest({ [name]: 'lefthook install' }) });

      const detail = getDetail(noUnguardedLefthookInstall(dir));
      expect(detail).toContain('1 found');
      expect(detail).toContain(`${name}: lefthook install`);
    },
  );

  it('reports every unguarded script together, whatever runner or flag it adds', () => {
    const dir = buildRepo({
      'package.json': buildManifest({
        preinstall: 'pnpm exec lefthook install --force',
        prepare: 'lefthook install && echo done',
      }),
    });

    const detail = getDetail(noUnguardedLefthookInstall(dir));
    expect(detail).toContain('2 found');
    expect(detail).toContain('preinstall: pnpm exec lefthook install --force');
    expect(detail).toContain('prepare: lefthook install && echo done');
  });

  it.each(['lefthook check-install || lefthook install', 'if ! lefthook check-install; then lefthook install; fi'])(
    'passes a guarded script: %s',
    (command) => {
      const dir = buildRepo({ 'package.json': buildManifest({ prepare: command }) });

      expect(noUnguardedLefthookInstall(dir)).toBe(true);
    },
  );

  it('ignores a script that pnpm install does not run', () => {
    const dir = buildRepo({ 'package.json': buildManifest({ hooks: 'lefthook install' }) });

    expect(noUnguardedLefthookInstall(dir)).toBe(true);
  });

  it('passes a manifest that declares no scripts', () => {
    const dir = buildRepo({ 'package.json': '{ "name": "root" }\n' });

    expect(noUnguardedLefthookInstall(dir)).toBe(true);
  });

  it('passes a manifest that does not parse', () => {
    const dir = buildRepo({ 'package.json': '{ "scripts": { "prepare": "lefthook install" }\n' });

    expect(noUnguardedLefthookInstall(dir)).toBe(true);
  });
});

// region | Helpers

/** Renders a root manifest that declares the given scripts. */
function buildManifest(scripts: Record<string, string>): string {
  return `${JSON.stringify({ name: 'root', scripts }, null, 2)}\n`;
}

// endregion | Helpers
