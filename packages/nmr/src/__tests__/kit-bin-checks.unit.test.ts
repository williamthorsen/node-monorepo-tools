import { pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import {
  everyBinTargetIsACommittedWrapper,
  everyBinWrapperTargetIsCoveredByFiles,
} from '../../.readyup/kits/default.ts';
import { buildMonorepo } from '../test-utils/fixture-repo.ts';
import { getDetail } from '../test-utils/getDetail.ts';

/** nmr's own wrapper shape: the build entry named as a bare dynamic import. */
const IMPORT_WRAPPER = "await import('../dist/esm/cli.js');\n";

/** The wrapper shape used by codeassembly and toolbelt: the build entry named through a URL that the wrapper then imports. */
const URL_WRAPPER =
  "const entryPoint = new URL('../dist/esm/cli.js', import.meta.url);\nawait import(entryPoint.href);\n";

describe(everyBinTargetIsACommittedWrapper, () => {
  it('reports a target under dist/', async () => {
    useMonorepo({ 'packages/tool/package.json': buildManifest({ bin: { tool: 'dist/esm/cli.js' } }) });

    const detail = getDetail(await everyBinTargetIsACommittedWrapper());
    expect(detail).toContain('1 found');
    expect(detail).toContain('@fixture/tool:tool -> dist/esm/cli.js (names a path under dist/)');
  });

  it('reports a target under dist/ written with a leading ./', async () => {
    useMonorepo({ 'packages/tool/package.json': buildManifest({ bin: { tool: './dist/esm/cli.js' } }) });

    expect(getDetail(await everyBinTargetIsACommittedWrapper())).toContain('-> dist/esm/cli.js');
  });

  it("names the command after the package where bin is npm's string form", async () => {
    useMonorepo({ 'packages/tool/package.json': buildManifest({ bin: './dist/esm/cli.js' }) });

    expect(getDetail(await everyBinTargetIsACommittedWrapper())).toContain('@fixture/tool:tool ->');
  });

  it('reports every offending entry of a package declaring several bins', async () => {
    useMonorepo({
      'packages/tool/package.json': buildManifest({ bin: { tool: 'dist/cli.js', 'tool-fmt': 'dist/cli-fmt.js' } }),
    });

    const detail = getDetail(await everyBinTargetIsACommittedWrapper());
    expect(detail).toContain('2 found');
    expect(detail).toContain('@fixture/tool:tool-fmt ->');
  });

  it('passes a committed wrapper outside a git repository, where no tracked listing can be read', async () => {
    useMonorepo({
      'packages/tool/bin/tool.js': IMPORT_WRAPPER,
      'packages/tool/package.json': buildManifest({ bin: { tool: 'bin/tool.js' } }),
    });

    await expect(everyBinTargetIsACommittedWrapper()).resolves.toBe(true);
  });

  it('passes a package declaring no bin', async () => {
    useMonorepo({ 'packages/tool/package.json': buildManifest({}) });

    await expect(everyBinTargetIsACommittedWrapper()).resolves.toBe(true);
  });
});

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
      'packages/tool/package.json': buildManifest({ bin: { tool: 'dist/esm/cli.js' }, files: ['bin'] }),
    });

    expect(everyBinWrapperTargetIsCoveredByFiles()).toBe(true);
  });
});

// region | Helpers

/** Renders a workspace manifest with the given fields, which every fixture package here needs a name beside. */
function buildManifest(fields: Record<string, unknown>): string {
  return `${JSON.stringify({ name: '@fixture/tool', ...fields }, undefined, 2)}\n`;
}

/** Builds a fixture monorepo and points `process.cwd()` at it, which is what workspace discovery reads. */
function useMonorepo(files: Record<string, string>): void {
  disposeOnTestFinished(pointCwdAt(buildMonorepo(files)));
}

// endregion | Helpers
