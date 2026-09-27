import { describe, expect, it } from 'vitest';

import { everyBinWrapperTargetIsCoveredByFiles } from '../../.readyup/kits/default.ts';
import { buildManifest } from '../test-utils/buildManifest.ts';
import { getDetail } from '../test-utils/getDetail.ts';
import { useMonorepo } from '../test-utils/useMonorepo.ts';

/** nmr's own wrapper shape: the build entry named as a bare dynamic import. */
const IMPORT_WRAPPER = "await import('../dist/esm/cli.js');\n";

/** The other wrapper shape: the build entry named through a URL that the wrapper then imports. */
const URL_WRAPPER =
  "const entryPoint = new URL('../dist/esm/cli.js', import.meta.url);\nawait import(entryPoint.href);\n";

describe(everyBinWrapperTargetIsCoveredByFiles, () => {
  it('passes when files names the directory the wrapper loads from', () => {
    useMonorepo({
      'packages/tool/bin/tool.js': IMPORT_WRAPPER,
      'packages/tool/package.json': buildManifest({ bin: { tool: 'bin/tool.js' }, files: ['bin', 'dist'] }),
    });

    expect(everyBinWrapperTargetIsCoveredByFiles()).toBe(true);
  });

  it('reports a wrapper whose build output files omits', () => {
    useMonorepo({
      'packages/tool/bin/tool.js': IMPORT_WRAPPER,
      'packages/tool/package.json': buildManifest({ bin: { tool: 'bin/tool.js' }, files: ['bin'] }),
    });

    const detail = getDetail(everyBinWrapperTargetIsCoveredByFiles());
    expect(detail).toContain('@fixture/tool:tool -> bin/tool.js -> dist/esm/cli.js');
  });

  it('reads the build entry a wrapper names through new URL', () => {
    useMonorepo({
      'packages/tool/bin/tool.js': URL_WRAPPER,
      'packages/tool/package.json': buildManifest({ bin: { tool: 'bin/tool.js' }, files: ['bin'] }),
    });

    expect(getDetail(everyBinWrapperTargetIsCoveredByFiles())).toContain('-> dist/esm/cli.js');
  });

  it('skips a package declaring no files, which publishes its whole tree', () => {
    useMonorepo({
      'packages/tool/bin/tool.js': IMPORT_WRAPPER,
      'packages/tool/package.json': buildManifest({ bin: { tool: 'bin/tool.js' } }),
    });

    expect(everyBinWrapperTargetIsCoveredByFiles()).toBe(true);
  });

  it('skips a wrapper naming no relative specifier', () => {
    useMonorepo({
      'packages/tool/bin/tool.js': "import { run } from 'some-package';\nrun();\n",
      'packages/tool/package.json': buildManifest({ bin: { tool: 'bin/tool.js' }, files: ['bin'] }),
    });

    expect(everyBinWrapperTargetIsCoveredByFiles()).toBe(true);
  });

  it('skips a bin target that is no wrapper, which the committed-wrapper check owns', () => {
    useMonorepo({
      // Build output the target names, whose own first relative import would otherwise read as a wrapper's.
      'packages/tool/dist/esm/cli.js': "import { runCli } from './runCli.js';\nrunCli();\n",
      'packages/tool/package.json': buildManifest({ bin: { tool: 'dist/esm/cli.js' }, files: ['bin'] }),
    });

    expect(everyBinWrapperTargetIsCoveredByFiles()).toBe(true);
  });

  it('skips a bin target with no readable file', () => {
    useMonorepo({
      'packages/tool/package.json': buildManifest({ bin: { tool: 'bin/tool.js' }, files: ['bin'] }),
    });

    expect(everyBinWrapperTargetIsCoveredByFiles()).toBe(true);
  });
});
