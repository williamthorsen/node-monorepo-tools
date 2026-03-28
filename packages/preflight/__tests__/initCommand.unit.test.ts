import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockScaffoldConfig = vi.hoisted(() => vi.fn());

vi.mock('../src/init/scaffold.ts', () => ({
  scaffoldConfig: mockScaffoldConfig,
}));

vi.mock(import('@williamthorsen/node-monorepo-core'), () => ({
  printError: vi.fn(),
  printSkip: vi.fn(),
  printStep: vi.fn(),
  printSuccess: vi.fn(),
}));

import { initCommand } from '../src/init/initCommand.ts';

describe(`${initCommand.name} error handling`, () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockScaffoldConfig.mockReset();
  });

  it('returns exit code 1 when scaffoldConfig throws', () => {
    mockScaffoldConfig.mockImplementation(() => {
      throw new Error('disk full');
    });

    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(1);
  });

  it('returns exit code 1 when scaffoldConfig returns a failed result', () => {
    mockScaffoldConfig.mockReturnValue({ filePath: '.config/preflight.config.ts', outcome: 'failed' });

    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(1);
  });

  it('returns exit code 0 when scaffoldConfig returns a created result', () => {
    mockScaffoldConfig.mockReturnValue({ filePath: '.config/preflight.config.ts', outcome: 'created' });

    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
  });
});
