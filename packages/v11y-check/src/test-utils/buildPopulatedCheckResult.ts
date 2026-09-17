import type { CheckResult, ScopeCheckResult } from '../format-check.ts';

/**
 * Builds a check result that reaches every branch of both text formatters: each scope holds an unallowed, an
 * allowed, a stale, and a below-threshold entry, and between them the entries cover every severity, a
 * multi-path advisory, a reason, and a multi-paragraph description.
 */
export function buildPopulatedCheckResult(): CheckResult {
  return {
    dev: buildPopulatedScopeResult('dev', 'critical'),
    prod: buildPopulatedScopeResult('prod', 'high'),
  };
}

// region | Helpers
/** Builds one scope's fully populated result, with IDs that name the scope. */
function buildPopulatedScopeResult(scope: string, unallowedSeverity: string): ScopeCheckResult {
  return {
    allowed: [
      {
        addedAt: '2026-04-01T00:00:00.000Z',
        description: 'An allowed advisory.\n\nIts second paragraph.',
        ghsaId: `GHSA-${scope}-allowed`,
        id: '1001',
        path: 'express',
        paths: ['express', 'app>express'],
        reason: 'No fix is published.',
        severity: 'moderate',
        title: 'Allowed advisory',
        url: `https://github.com/advisories/GHSA-${scope}-allowed`,
      },
      // An unparseable date takes the suffix's other branch.
      {
        addedAt: 'not-a-date',
        id: '1002',
        path: 'qs',
        paths: ['qs'],
        severity: 'info',
        url: 'https://example.com/1002',
      },
    ],
    belowThreshold: [
      {
        description: 'A below-threshold advisory.',
        ghsaId: `GHSA-${scope}-low`,
        id: '1003',
        path: 'brace-expansion',
        paths: ['brace-expansion'],
        severity: 'low',
        title: 'Below-threshold advisory',
        url: `https://github.com/advisories/GHSA-${scope}-low`,
      },
    ],
    stale: [{ id: `GHSA-${scope}-stale` }],
    unallowed: [
      {
        description: 'An unallowed advisory.',
        ghsaId: `GHSA-${scope}-unallowed`,
        id: '1004',
        path: 'lodash',
        paths: ['lodash'],
        severity: unallowedSeverity,
        title: 'Unallowed advisory',
        url: `https://github.com/advisories/GHSA-${scope}-unallowed`,
      },
    ],
  };
}
// endregion | Helpers
