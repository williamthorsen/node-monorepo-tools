import { describe, expect, it } from 'vitest';

import { parseCommitMessage } from '../parseCommitMessage.ts';
import type { WorkTypeConfig } from '../types.ts';

const workTypes: Record<string, WorkTypeConfig> = {
  fix: { header: 'Bug fixes', aliases: ['bugfix'] },
  feat: { header: 'Features', aliases: ['feature'] },
  refactor: { header: 'Refactoring' },
  docs: { header: 'Documentation', aliases: ['doc'] },
};

describe(parseCommitMessage, () => {
  it('parses a simple "type: description" message', () => {
    const result = parseCommitMessage('feat: add login page', 'abc123', workTypes);
    expect(result).toStrictEqual({
      message: 'feat: add login page',
      hash: 'abc123',
      type: 'feat',
      description: 'add login page',
      breaking: false,
    });
  });

  it('parses a "workspace|type: description" message', () => {
    const result = parseCommitMessage('web|fix: resolve navbar bug', 'def456', workTypes);
    expect(result).toStrictEqual({
      message: 'web|fix: resolve navbar bug',
      hash: 'def456',
      type: 'fix',
      description: 'resolve navbar bug',
      workspace: 'web',
      breaking: false,
    });
  });

  it('resolves an alias to its canonical type', () => {
    const result = parseCommitMessage('feature: new dashboard', 'ghi789', workTypes);
    expect(result).toStrictEqual({
      message: 'feature: new dashboard',
      hash: 'ghi789',
      type: 'feat',
      description: 'new dashboard',
      breaking: false,
    });
  });

  it('resolves an alias in workspace format', () => {
    const result = parseCommitMessage('api|bugfix: fix timeout', 'jkl012', workTypes);
    expect(result).toStrictEqual({
      message: 'api|bugfix: fix timeout',
      hash: 'jkl012',
      type: 'fix',
      description: 'fix timeout',
      workspace: 'api',
      breaking: false,
    });
  });

  it('detects a breaking change via ! marker', () => {
    const result = parseCommitMessage('feat!: redesign API', 'mno345', workTypes);
    expect(result).toBeDefined();
    expect(result?.breaking).toBe(true);
  });

  it('detects a breaking change via BREAKING CHANGE in message', () => {
    const result = parseCommitMessage('feat: new API BREAKING CHANGE: removed old endpoint', 'pqr678', workTypes);
    expect(result).toBeDefined();
    expect(result?.breaking).toBe(true);
  });

  it('returns undefined for an unrecognized type', () => {
    const result = parseCommitMessage('unknown: some change', 'stu901', workTypes);
    expect(result).toBeUndefined();
  });

  it('returns undefined for a message without a type prefix', () => {
    const result = parseCommitMessage('just a plain message', 'vwx234', workTypes);
    expect(result).toBeUndefined();
  });

  it('returns undefined for an empty message', () => {
    const result = parseCommitMessage('', 'yz5678', workTypes);
    expect(result).toBeUndefined();
  });

  it('handles doc alias', () => {
    const result = parseCommitMessage('doc: update README', 'abc999', workTypes);
    expect(result).toStrictEqual({
      message: 'doc: update README',
      hash: 'abc999',
      type: 'docs',
      description: 'update README',
      breaking: false,
    });
  });

  it('resolves an uppercase type to its canonical lowercase form', () => {
    const result = parseCommitMessage('FEAT: add login', 'upper1', workTypes);
    expect(result).toStrictEqual({
      message: 'FEAT: add login',
      hash: 'upper1',
      type: 'feat',
      description: 'add login',
      breaking: false,
    });
  });

  it('resolves a mixed-case alias to its canonical type', () => {
    const result = parseCommitMessage('Feature: new dashboard', 'upper2', workTypes);
    expect(result).toStrictEqual({
      message: 'Feature: new dashboard',
      hash: 'upper2',
      type: 'feat',
      description: 'new dashboard',
      breaking: false,
    });
  });

  it('parses a workspace prefix combined with a breaking change marker', () => {
    const result = parseCommitMessage('api|feat!: redesign endpoint', 'combo1', workTypes);
    expect(result).toStrictEqual({
      message: 'api|feat!: redesign endpoint',
      hash: 'combo1',
      type: 'feat',
      description: 'redesign endpoint',
      workspace: 'api',
      breaking: true,
    });
  });

  describe('workspace alias resolution', () => {
    const aliases: Record<string, string> = {
      api: 'backend-api',
      web: 'frontend-web',
    };

    it('resolves a workspace alias to its canonical name', () => {
      const result = parseCommitMessage('api|fix: fix timeout', 'ws1', workTypes, aliases);
      expect(result).toStrictEqual({
        message: 'api|fix: fix timeout',
        hash: 'ws1',
        type: 'fix',
        description: 'fix timeout',
        workspace: 'backend-api',
        breaking: false,
      });
    });

    it('passes through an unknown workspace unchanged', () => {
      const result = parseCommitMessage('mobile|feat: add splash screen', 'ws2', workTypes, aliases);
      expect(result).toStrictEqual({
        message: 'mobile|feat: add splash screen',
        hash: 'ws2',
        type: 'feat',
        description: 'add splash screen',
        workspace: 'mobile',
        breaking: false,
      });
    });

    it('does not resolve workspace aliases when no alias map is provided', () => {
      const result = parseCommitMessage('api|fix: fix timeout', 'ws3', workTypes);
      expect(result).toStrictEqual({
        message: 'api|fix: fix timeout',
        hash: 'ws3',
        type: 'fix',
        description: 'fix timeout',
        workspace: 'api',
        breaking: false,
      });
    });

    it('resolves workspace alias with breaking change marker', () => {
      const result = parseCommitMessage('web|feat!: redesign layout', 'ws4', workTypes, aliases);
      expect(result).toStrictEqual({
        message: 'web|feat!: redesign layout',
        hash: 'ws4',
        type: 'feat',
        description: 'redesign layout',
        workspace: 'frontend-web',
        breaking: true,
      });
    });
  });
});
