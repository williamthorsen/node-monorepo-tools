import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateTags = vi.hoisted(() => vi.fn());

vi.mock('../createTags.ts', () => ({
  createTags: mockCreateTags,
}));

import { tagCommand } from '../tagCommand.ts';

/** Sentinel error thrown by the mocked process.exit. */
class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe(tagCommand, () => {
  beforeEach(() => {
    mockCreateTags.mockReturnValue([]);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mockCreateTags.mockReset();
    vi.restoreAllMocks();
  });

  it('delegates to createTags with default options', () => {
    tagCommand([]);

    expect(mockCreateTags).toHaveBeenCalledWith({ dryRun: false, noGitChecks: false });
  });

  it('passes dryRun when --dry-run is provided', () => {
    tagCommand(['--dry-run']);

    expect(mockCreateTags).toHaveBeenCalledWith({ dryRun: true, noGitChecks: false });
  });

  it('passes noGitChecks when --no-git-checks is provided', () => {
    tagCommand(['--no-git-checks']);

    expect(mockCreateTags).toHaveBeenCalledWith({ dryRun: false, noGitChecks: true });
  });

  it('passes both flags when both are provided', () => {
    tagCommand(['--dry-run', '--no-git-checks']);

    expect(mockCreateTags).toHaveBeenCalledWith({ dryRun: true, noGitChecks: true });
  });

  it('exits with code 1 on unknown flags', () => {
    expect(() => tagCommand(['--unknown'])).toThrow(ExitError);

    expect(console.error).toHaveBeenCalledWith('Error: Unknown option: --unknown');
    expect(mockCreateTags).not.toHaveBeenCalled();
  });

  it('exits with code 1 when createTags throws', () => {
    mockCreateTags.mockImplementation(() => {
      throw new Error('No tags file found. Run `release-kit prepare` first.');
    });

    expect(() => tagCommand([])).toThrow(ExitError);

    expect(console.error).toHaveBeenCalledWith('No tags file found. Run `release-kit prepare` first.');
  });
});
