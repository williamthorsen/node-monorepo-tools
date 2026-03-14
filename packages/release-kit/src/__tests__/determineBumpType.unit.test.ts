import { describe, expect, it } from 'vitest';

import { DEFAULT_VERSION_PATTERNS } from '../defaults.ts';
import { determineBumpType } from '../determineBumpType.ts';
import type { ParsedCommit, VersionPatterns, WorkTypeConfig } from '../types.ts';

const workTypes: Record<string, WorkTypeConfig> = {
  fix: { header: 'Bug fixes', aliases: ['bugfix'] },
  feat: { header: 'Features', aliases: ['feature'] },
  refactor: { header: 'Refactoring' },
  docs: { header: 'Documentation', aliases: ['doc'] },
};

const versionPatterns = DEFAULT_VERSION_PATTERNS;

function makeCommit(overrides: Partial<ParsedCommit> & Pick<ParsedCommit, 'type'>): ParsedCommit {
  return {
    message: `${overrides.type}: test`,
    hash: 'abc123',
    description: 'test',
    breaking: false,
    ...overrides,
  };
}

describe(determineBumpType, () => {
  it('returns undefined for an empty commit list', () => {
    const result = determineBumpType([], workTypes, versionPatterns);
    expect(result).toBeUndefined();
  });

  it('returns patch for a fix commit', () => {
    const commits = [makeCommit({ type: 'fix' })];
    const result = determineBumpType(commits, workTypes, versionPatterns);
    expect(result).toBe('patch');
  });

  it('returns minor for a feat commit', () => {
    const commits = [makeCommit({ type: 'feat' })];
    const result = determineBumpType(commits, workTypes, versionPatterns);
    expect(result).toBe('minor');
  });

  it('returns the highest priority bump when multiple types are present', () => {
    const commits = [makeCommit({ type: 'fix' }), makeCommit({ type: 'feat' }), makeCommit({ type: 'docs' })];
    const result = determineBumpType(commits, workTypes, versionPatterns);
    expect(result).toBe('minor');
  });

  it('returns major for a breaking change', () => {
    const commits = [makeCommit({ type: 'fix' }), makeCommit({ type: 'feat', breaking: true })];
    const result = determineBumpType(commits, workTypes, versionPatterns);
    expect(result).toBe('major');
  });

  it('returns major even when breaking change is a patch type', () => {
    const commits = [makeCommit({ type: 'fix', breaking: true })];
    const result = determineBumpType(commits, workTypes, versionPatterns);
    expect(result).toBe('major');
  });

  it('ignores commits with unrecognized types', () => {
    const commits = [makeCommit({ type: 'unknown' })];
    const result = determineBumpType(commits, workTypes, versionPatterns);
    expect(result).toBeUndefined();
  });

  it('returns the correct bump when some commits are unrecognized', () => {
    const commits = [makeCommit({ type: 'unknown' }), makeCommit({ type: 'fix' })];
    const result = determineBumpType(commits, workTypes, versionPatterns);
    expect(result).toBe('patch');
  });

  it('returns major immediately when the first commit is a breaking change', () => {
    const commits = [makeCommit({ type: 'feat', breaking: true }), makeCommit({ type: 'fix' })];
    const result = determineBumpType(commits, workTypes, versionPatterns);
    expect(result).toBe('major');
  });

  it('returns undefined when workTypes is empty', () => {
    const commits = [makeCommit({ type: 'feat' })];
    const result = determineBumpType(commits, {}, versionPatterns);
    expect(result).toBeUndefined();
  });

  it('treats custom minor patterns as minor bumps', () => {
    const customPatterns: VersionPatterns = { major: ['!'], minor: ['feat', 'perf'] };
    const customTypes: Record<string, WorkTypeConfig> = {
      ...workTypes,
      perf: { header: 'Performance' },
    };
    const commits = [makeCommit({ type: 'perf' })];
    const result = determineBumpType(commits, customTypes, customPatterns);
    expect(result).toBe('minor');
  });

  it('does not treat a breaking commit as major when "!" is absent from versionPatterns.major', () => {
    const customPatterns: VersionPatterns = { major: ['breaking-change'], minor: ['feat'] };
    const commits = [makeCommit({ type: 'fix', breaking: true })];
    const result = determineBumpType(commits, workTypes, customPatterns);
    expect(result).toBe('patch');
  });
});
