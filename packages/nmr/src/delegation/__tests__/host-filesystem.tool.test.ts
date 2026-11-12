import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { composeFilesystemCheckScript } from '../host-filesystem.ts';

describe(composeFilesystemCheckScript, () => {
  it('prints the free counts of the filesystem that holds the home directory', () => {
    const result = spawnSync('/bin/sh', ['-c', composeFilesystemCheckScript()], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toStrictEqual({
      bavail: expect.any(Number),
      ffree: expect.any(Number),
      files: expect.any(Number),
    });
  });
});
