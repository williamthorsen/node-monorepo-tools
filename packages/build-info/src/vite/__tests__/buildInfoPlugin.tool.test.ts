import path from 'node:path';

import { build, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';

import { parseBuildInfo } from '../../contract/parse.ts';
import { buildInfoPlugin } from '../buildInfoPlugin.ts';

const APP_DIR = path.join(import.meta.dirname, 'fixtures', 'app');
const NOW = new Date('2026-10-08T06:29:41.000Z');

describe(buildInfoPlugin, () => {
  it('defines __BUILD_INFO__ and emits build-info.json', async () => {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      root: APP_DIR,
      plugins: [buildInfoPlugin({ cwd: APP_DIR, env: {}, now: NOW, readGit: false })],
      build: {
        lib: { entry: path.join(APP_DIR, 'main.ts'), formats: ['es'], fileName: 'main' },
        write: false,
      },
    });

    const output = readOutput(result);
    const chunk = output.find((file) => file.type === 'chunk');
    const asset = output.find((file) => file.type === 'asset' && file.fileName === 'build-info.json');

    expect(chunk?.type === 'chunk' && chunk.code).toContain('"1.2.3"');
    expect(asset?.type === 'asset' && parseBuildInfo(JSON.parse(String(asset.source)))).toMatchObject({
      name: 'vite-fixture-app',
      version: '1.2.3',
      buildTime: '2026-10-08T06:29:41.000Z',
      host: 'local',
    });
  });
});

// region | Helpers

/** Returns the output files of an unwritten library build with one format, which Vite reports as a one-item array. */
function readOutput(result: Awaited<ReturnType<typeof build>>): Rolldown.RolldownOutput['output'] {
  const outputs = [result].flat();
  const [first] = outputs;
  if (outputs.length !== 1 || first === undefined || !('output' in first)) {
    throw new TypeError('Expected the output of one unwritten build');
  }
  return first.output;
}

// endregion | Helpers
