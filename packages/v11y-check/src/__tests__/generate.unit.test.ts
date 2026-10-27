import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { buildFlatConfig, generateAuditCiConfig } from '../generate.ts';
import type { ScopeConfig } from '../types.ts';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'v11y-check-generate-test-' })),
);

describe(buildFlatConfig, () => {
  it('flattens allowlist entries to an array of IDs', () => {
    const scopeConfig: ScopeConfig = {
      allowlist: [
        { id: 'GHSA-1234', path: 'lodash', url: 'https://example.com/1' },
        { id: 'GHSA-5678', path: 'express', url: 'https://example.com/2' },
      ],
      severityThreshold: 'moderate',
    };

    const flatConfig = buildFlatConfig(scopeConfig, 'prod');
    expect(flatConfig).toMatchObject({
      allowlist: ['GHSA-1234', 'GHSA-5678'],
      moderate: true,
      'show-not-found': true,
    });
  });

  it('produces an empty allowlist when the source does not have any entries', () => {
    const scopeConfig: ScopeConfig = { allowlist: [], severityThreshold: 'high' };
    const flatConfig = buildFlatConfig(scopeConfig, 'dev');
    expect(flatConfig).toMatchObject({
      allowlist: [],
      high: true,
    });
  });

  it('omits severity keys when severityThreshold is undefined', () => {
    const scopeConfig: ScopeConfig = { allowlist: [] };
    const flatConfig = buildFlatConfig(scopeConfig, 'dev');
    expect(flatConfig).not.toHaveProperty('moderate');
    expect(flatConfig).not.toHaveProperty('high');
    expect(flatConfig).not.toHaveProperty('critical');
    expect(flatConfig).not.toHaveProperty('low');
  });

  it.each([
    { threshold: 'low' as const, expectedKey: 'low' },
    { threshold: 'moderate' as const, expectedKey: 'moderate' },
    { threshold: 'high' as const, expectedKey: 'high' },
    { threshold: 'critical' as const, expectedKey: 'critical' },
  ])('translates severityThreshold "$threshold" to { $expectedKey: true }', ({ threshold, expectedKey }) => {
    const scopeConfig: ScopeConfig = { allowlist: [], severityThreshold: threshold };
    const flatConfig = buildFlatConfig(scopeConfig, 'dev');
    expect(flatConfig[expectedKey]).toBe(true);
  });

  it('adds skip-dev for prod scope', () => {
    const flatConfig = buildFlatConfig({ allowlist: [] }, 'prod');
    expect(flatConfig['skip-dev']).toBe(true);
    expect(flatConfig).not.toHaveProperty('extra-args');
  });

  it('adds extra-args ["--dev"] for dev scope', () => {
    const flatConfig = buildFlatConfig({ allowlist: [] }, 'dev');
    expect(flatConfig['extra-args']).toStrictEqual(['--dev']);
    expect(flatConfig).not.toHaveProperty('skip-dev');
  });
});

describe(generateAuditCiConfig, () => {
  it('writes the flat config file to the output directory', async ({ tree }) => {
    const scopeConfig: ScopeConfig = { allowlist: [], severityThreshold: 'moderate' };
    const outputPath = await generateAuditCiConfig(scopeConfig, 'dev', tree.dir);

    expect(outputPath).toBe(path.join(tree.dir, 'audit-ci.dev.json'));
    const content: unknown = JSON.parse(await readFile(outputPath, 'utf8'));
    expect(content).toHaveProperty('allowlist', []);
    expect(content).toHaveProperty('moderate', true);
  });

  it('round-trips: config values appear in generated JSON', async ({ tree }) => {
    const scopeConfig: ScopeConfig = {
      allowlist: [{ id: 'GHSA-abcd', path: 'pkg', url: 'https://example.com' }],
      severityThreshold: 'critical',
    };
    const outputPath = await generateAuditCiConfig(scopeConfig, 'dev', tree.dir);
    const content: unknown = JSON.parse(await readFile(outputPath, 'utf8'));

    expect(content).toHaveProperty('allowlist', ['GHSA-abcd']);
    expect(content).toHaveProperty('critical', true);
    expect(content).toHaveProperty('show-not-found', true);
  });
});
