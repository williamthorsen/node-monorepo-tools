import { describe, expect, it } from 'vitest';

import { syncLabelsConfigScript } from '../templates.ts';
import type { LabelDefinition } from '../types.ts';

describe(syncLabelsConfigScript, () => {
  it('contains the expected import and export lines', () => {
    const result = syncLabelsConfigScript([]);

    expect(result).toContain("import type { SyncLabelsConfig } from '@williamthorsen/release-kit'");
    expect(result).toContain('export default config;');
    expect(result).toContain('const config: SyncLabelsConfig');
  });

  it('produces valid output with an empty scope labels array', () => {
    const result = syncLabelsConfigScript([]);

    expect(result).toContain("presets: ['common']");
    expect(result).toContain('labels: [');
    expect(result).toContain('],');
  });

  it('interpolates scope labels correctly', () => {
    const scopeLabels: LabelDefinition[] = [
      { name: 'scope:root', color: '00ff96', description: 'Monorepo root configuration' },
      { name: 'scope:my-package', color: '00ff96', description: 'my-package package' },
    ];

    const result = syncLabelsConfigScript(scopeLabels);

    expect(result).toContain("name: 'scope:root'");
    expect(result).toContain("name: 'scope:my-package'");
    expect(result).toContain("description: 'Monorepo root configuration'");
  });

  it('escapes single quotes in label values', () => {
    const scopeLabels: LabelDefinition[] = [
      { name: "scope:it's-a-package", color: '00ff96', description: "it's a package" },
    ];

    const result = syncLabelsConfigScript(scopeLabels);

    expect(result).toContain(String.raw`name: 'scope:it\'s-a-package'`);
    expect(result).toContain(String.raw`description: 'it\'s a package'`);
  });

  it('escapes backslashes in label values', () => {
    const scopeLabels: LabelDefinition[] = [
      { name: String.raw`scope:back\slash`, color: '00ff96', description: String.raw`has \ backslash` },
    ];

    const result = syncLabelsConfigScript(scopeLabels);

    expect(result).toContain(String.raw`name: 'scope:back\\slash'`);
    expect(result).toContain(String.raw`description: 'has \\ backslash'`);
  });
});
