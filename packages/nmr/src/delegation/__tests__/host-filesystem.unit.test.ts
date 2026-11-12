import { describe, expect, it, vi } from 'vitest';

import { appendFilesystemReason, describeExhaustedResource } from '../host-filesystem.ts';

describe(appendFilesystemReason, () => {
  it.for(['fatal: write error: No space left on device', 'ERR_PNPM_ENOSPC  ENOSPC: no space left'])(
    'appends the exhausted resource to a step whose output reads %s',
    async (output) => {
      const runOnHost = vi.fn(() => Promise.resolve({ exitCode: 0, output: '{"bavail":1000,"ffree":0}\n' }));

      await expect(appendFilesystemReason('could not push to box', output, runOnHost)).resolves.toBe(
        "could not push to box: the host's filesystem has run out of inodes",
      );
    },
  );

  it('does not check the host when the output does not report a full filesystem', async () => {
    const runOnHost = vi.fn(() => Promise.resolve({ exitCode: 0, output: '{"bavail":0,"ffree":0}\n' }));

    await expect(appendFilesystemReason('could not push to box', 'rejected', runOnHost)).resolves.toBe(
      'could not push to box',
    );
    expect(runOnHost).not.toHaveBeenCalled();
  });

  it('keeps the message when the check fails', async () => {
    const runOnHost = vi.fn(() => Promise.resolve({ exitCode: 127, output: 'node: not found\n' }));

    await expect(appendFilesystemReason('could not install on box', 'ENOSPC', runOnHost)).resolves.toBe(
      'could not install on box',
    );
  });
});

describe(describeExhaustedResource, () => {
  it.for([
    {
      scenario: 'no inodes are free',
      output: '{"bavail":1000,"ffree":0}\n',
      expected: "the host's filesystem has run out of inodes",
    },
    {
      scenario: 'no blocks are available',
      output: '{"bavail":0,"ffree":1000}\n',
      expected: "the host's filesystem has run out of space",
    },
    {
      scenario: 'both are exhausted',
      output: '{"bavail":0,"ffree":0}\n',
      expected: "the host's filesystem has run out of inodes",
    },
    { scenario: 'neither is exhausted', output: '{"bavail":1000,"ffree":1000}\n', expected: undefined },
    {
      scenario: 'a startup file printed before the counts',
      output: 'Loading startup files...\n{"bavail":1000,"ffree":0}\n',
      expected: "the host's filesystem has run out of inodes",
    },
    { scenario: 'the output does not include the counts', output: 'node: not found\n', expected: undefined },
    { scenario: 'a count is not a number', output: '{"bavail":"0","ffree":"0"}\n', expected: undefined },
  ])('returns $expected when $scenario', ({ expected, output }) => {
    expect(describeExhaustedResource(output)).toBe(expected);
  });
});
