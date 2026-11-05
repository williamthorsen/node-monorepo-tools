import process from 'node:process';

import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockRunCli = vi.hoisted(() => vi.fn());

vi.mock(import('../runCli.ts'), () => ({
  runCli: mockRunCli,
}));

describe('release-kit entry', () => {
  afterEach(() => {
    process.exitCode = undefined;
    mockRunCli.mockReset();
    vi.resetModules();
  });

  it('reports a crash as an internal error with its stack frames, and exits 1', async () => {
    mockRunCli.mockRejectedValue(new TypeError('Cannot read properties of undefined'));
    using capture = captureStdio();

    await import('../cli.ts');

    expect(capture.stderr).toMatch(/^release-kit: internal error: Cannot read properties of undefined\n {4}at /);
    expect(process.exitCode).toBe(1);
  });

  it('reports a UserError as `Error: <message>`, and exits 1', async () => {
    // Import the class from the registry that `cli.ts` loads, which `vi.resetModules` replaces between tests.
    const { UserError } = await import('@williamthorsen/nmr-core');
    mockRunCli.mockRejectedValue(new UserError('Failed to discover workspaces: no pnpm-workspace.yaml'));
    using capture = captureStdio();

    await import('../cli.ts');

    expect(capture.stderr).toBe('Error: Failed to discover workspaces: no pnpm-workspace.yaml\n');
    expect(process.exitCode).toBe(1);
  });

  it('passes the arguments after the script path to the dispatch', async () => {
    mockRunCli.mockResolvedValue(undefined);
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'release-kit', 'tag', '--dry-run']);

    await import('../cli.ts');

    expect(mockRunCli).toHaveBeenCalledWith(['tag', '--dry-run']);
    expect(process.exitCode).toBeUndefined();
  });
});
