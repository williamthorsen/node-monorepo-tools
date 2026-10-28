import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { ProcessExitError, silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseArgs } from '../prepareArgs.ts';

describe(parseArgs, () => {
  let stdioCapture: CapturedStdio;

  beforeEach(() => {
    stdioCapture = captureStdio();
    void throwOnProcessExit();
    void silenceConsole(['info']);
  });

  afterEach(() => {
    stdioCapture[Symbol.dispose]();
    vi.restoreAllMocks();
  });

  it('exits with an error for an invalid bump type', () => {
    expect(() => parseArgs(['--bump=invalid'])).toThrow(ProcessExitError);
    expect(stdioCapture.stderr).toContain('Invalid bump type');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with an error for an unknown flag with the flag name in the message', () => {
    expect(() => parseArgs(['--foo'])).toThrow(ProcessExitError);
    expect(stdioCapture.stderr).toContain('Unknown option: --foo');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('parses --config into configPath and leaves it undefined when absent', () => {
    expect(parseArgs(['--config', 'elsewhere/alternative.config.ts']).configPath).toBe(
      'elsewhere/alternative.config.ts',
    );
    expect(parseArgs([]).configPath).toBeUndefined();
  });

  it('rejects --help=value as an unknown option', () => {
    // The bin dispatcher only intercepts bare `--help`/`-h`; it passes the `=value` form on to
    // parseArgs, which does not recognize `--help` as a flag.
    expect(() => parseArgs(['--help=value'])).toThrow(ProcessExitError);
    expect(stdioCapture.stderr).toContain('Unknown option: --help');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('accepts --force without --bump and defaults force to true', () => {
    // `--force` is a pure release trigger; runtime defaults the level to patch when
    // `--bump` is not supplied. Parsing must accept the flag without requiring `--bump`.
    const result = parseArgs(['--force']);
    expect(result.shouldForce).toBe(true);
    expect(result.bumpOverride).toBeUndefined();
  });

  it('exits with an error when --only value is empty', () => {
    expect(() => parseArgs(['--only='])).toThrow(ProcessExitError);
    expect(stdioCapture.stderr).toContain('Missing value for option: --only');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('returns the raw --set-version value, whose form the mode decides', () => {
    const result = parseArgs(['--set-version=arrays@1.0.0']);
    expect(result.setVersion).toBe('arrays@1.0.0');
  });

  it('exits with an error when --set-version is empty', () => {
    expect(() => parseArgs(['--set-version='])).toThrow(ProcessExitError);
    expect(stdioCapture.stderr).toContain('Missing value for option: --set-version');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('parses --no-git-checks flag', () => {
    const result = parseArgs(['--no-git-checks']);
    expect(result.shouldSkipGitChecks).toBe(true);
  });

  it('parses -n as shorthand for --no-git-checks', () => {
    const result = parseArgs(['-n']);
    expect(result.shouldSkipGitChecks).toBe(true);
  });

  it('defaults shouldSkipGitChecks to false', () => {
    const result = parseArgs([]);
    expect(result.shouldSkipGitChecks).toBe(false);
  });

  it('parses --with-release-notes flag', () => {
    const result = parseArgs(['--with-release-notes']);
    expect(result.shouldIncludeReleaseNotes).toBe(true);
  });

  it('defaults shouldIncludeReleaseNotes to false', () => {
    const result = parseArgs([]);
    expect(result.shouldIncludeReleaseNotes).toBe(false);
  });
});
