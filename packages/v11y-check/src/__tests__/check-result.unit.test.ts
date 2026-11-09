import { describe, expect, it } from 'vitest';

import { classifyScopeResults, resolveSeverityThreshold } from '../check-result.ts';
import type { AuditResult } from '../types.ts';

describe(classifyScopeResults, () => {
  it('classifies a result at or above the threshold that the allowlist omits as unallowed', () => {
    const result = buildAuditResult({ id: 'GHSA-bad', severity: 'high' });

    const scopeResult = classifyScopeResults([result], { allowlist: [] });

    expect(scopeResult).toStrictEqual({ allowed: [], belowThreshold: [], stale: [], unallowed: [result] });
  });

  it('classifies an allowlisted result as allowed, merging its advisory fields with the entry metadata', () => {
    const result = buildAuditResult({
      cvss: { score: 7.5 },
      description: 'Detailed description',
      ghsaId: 'GHSA-enriched',
      id: 'GHSA-enriched',
      paths: ['pkg', 'root>pkg'],
      severity: 'high',
      title: 'Prototype pollution',
    });

    const scopeResult = classifyScopeResults([result], {
      allowlist: [
        {
          addedAt: '2026-04-01T00:00:00.000Z',
          id: 'GHSA-enriched',
          reason: 'Accepted risk',
          url: 'https://example.com/entry',
        },
      ],
    });

    expect(scopeResult.allowed).toStrictEqual([
      {
        addedAt: '2026-04-01T00:00:00.000Z',
        cvss: { score: 7.5 },
        description: 'Detailed description',
        ghsaId: 'GHSA-enriched',
        id: 'GHSA-enriched',
        path: 'pkg',
        paths: ['pkg', 'root>pkg'],
        reason: 'Accepted risk',
        severity: 'high',
        title: 'Prototype pollution',
        url: 'https://example.com/GHSA-enriched',
      },
    ]);
    expect(scopeResult.unallowed).toStrictEqual([]);
  });

  it('omits the optional fields that neither the result nor the entry sets', () => {
    const scopeResult = classifyScopeResults([buildAuditResult({ id: 'GHSA-bare' })], {
      allowlist: [{ id: 'GHSA-bare', url: 'https://example.com/entry' }],
    });

    expect(scopeResult.allowed).toStrictEqual([
      { id: 'GHSA-bare', path: 'pkg', paths: ['pkg'], url: 'https://example.com/GHSA-bare' },
    ]);
  });

  it('reports each allowlist entry that matches none of the results as stale, in allowlist order', () => {
    const scopeResult = classifyScopeResults([buildAuditResult({ id: 'GHSA-found', severity: 'high' })], {
      allowlist: [
        { id: 'GHSA-stale-b', url: 'https://example.com/b' },
        { id: 'GHSA-found', url: 'https://example.com/found' },
        { id: 'GHSA-stale-a', url: 'https://example.com/a' },
      ],
    });

    expect(scopeResult.stale).toStrictEqual([{ id: 'GHSA-stale-b' }, { id: 'GHSA-stale-a' }]);
  });

  it('classifies a result below the threshold as belowThreshold', () => {
    const low = buildAuditResult({ id: 'GHSA-low', severity: 'low' });
    const moderate = buildAuditResult({ id: 'GHSA-moderate', severity: 'moderate' });

    const scopeResult = classifyScopeResults([low, moderate], { allowlist: [], severityThreshold: 'high' });

    expect(scopeResult).toStrictEqual({ allowed: [], belowThreshold: [low, moderate], stale: [], unallowed: [] });
  });

  it('classifies an allowlisted result below the threshold as belowThreshold, not allowed', () => {
    const low = buildAuditResult({ id: 'GHSA-low', severity: 'low' });

    const scopeResult = classifyScopeResults([low], {
      allowlist: [{ id: 'GHSA-low', url: 'https://example.com/low' }],
      severityThreshold: 'high',
    });

    expect(scopeResult).toStrictEqual({ allowed: [], belowThreshold: [low], stale: [], unallowed: [] });
  });

  it('treats a result without a severity as at or above the threshold', () => {
    const result = buildAuditResult({ id: 'GHSA-unknown' });

    const scopeResult = classifyScopeResults([result], { allowlist: [], severityThreshold: 'critical' });

    expect(scopeResult.unallowed).toStrictEqual([result]);
  });
});

describe(resolveSeverityThreshold, () => {
  it('returns the configured threshold', () => {
    expect(resolveSeverityThreshold({ allowlist: [], severityThreshold: 'moderate' })).toBe('moderate');
  });

  it('defaults to low when the scope does not set a threshold', () => {
    expect(resolveSeverityThreshold({ allowlist: [] })).toBe('low');
  });
});

// region | Helpers
/** Builds an audit result for a package named `pkg`, with a URL derived from the ID. */
function buildAuditResult(fields: Partial<AuditResult> & { id: string }): AuditResult {
  return { path: 'pkg', paths: ['pkg'], url: `https://example.com/${fields.id}`, ...fields };
}
// endregion | Helpers
