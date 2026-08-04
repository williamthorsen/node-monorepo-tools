import type { Workspace } from 'readyup/check-utils';
import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceCheck,
  classifyNpmAuth,
  classifyTrustQuery,
  packagesChecklist,
  skipIfNotPublishable,
} from '../../.readyup/kits/npm-auto-publish.ts';

// Verbatim payloads from npm 11.16.0. Both commands write the envelope to stdout and exit nonzero.
const WHOAMI_E401 =
  '{"error":{"code":"E401","summary":"401 Unauthorized - GET https://registry.npmjs.org/-/whoami","detail":""}}';
const TRUST_E401 = String.raw`{"error":{"code":"E401","summary":"401 Unauthorized - GET https://registry.npmjs.org/-/package/@williamthorsen%2frelease-kit/trust - {\"success\":false,\"error\":\"You must be logged in to publish packages.\"}","detail":""}}`;

const OWNER_REPO = 'williamthorsen/node-monorepo-tools';
const WORKFLOW_FILE = 'publish.yaml';

function makeWorkspace(overrides: Partial<Workspace> & Pick<Workspace, 'isPackage'>): Workspace {
  return {
    dir: 'packages/example',
    absolutePath: '/repo/packages/example',
    name: '@scope/example',
    packageJson: { name: '@scope/example' },
    ...overrides,
  };
}

describe(skipIfNotPublishable, () => {
  it('returns false for a publishable workspace (isPackage true)', () => {
    const workspace = makeWorkspace({ isPackage: true });

    expect(skipIfNotPublishable(workspace)).toBe(false);
  });

  it('returns the skip reason for a non-publishable workspace (isPackage false)', () => {
    const workspace = makeWorkspace({ isPackage: false, packageJson: { name: '@scope/example', private: true } });

    expect(skipIfNotPublishable(workspace)).toBe('package.json#private is true');
  });
});

describe(buildWorkspaceCheck, () => {
  it('marks the parent check as skipped for a non-publishable workspace', async () => {
    const workspace = makeWorkspace({ isPackage: false, packageJson: { name: '@scope/example', private: true } });

    const check = buildWorkspaceCheck(workspace);

    expect(check.name).toBe('@scope/example');
    expect(check.skip).toBeDefined();
    await expect(Promise.resolve(check.skip?.())).resolves.toBe('package.json#private is true');
  });

  it('does not include a "not marked private" child check', () => {
    const workspace = makeWorkspace({ isPackage: true });

    const check = buildWorkspaceCheck(workspace);

    const childNames = check.checks?.map((c) => c.name) ?? [];
    expect(childNames).not.toContain('not marked private');
  });

  it('lets the parent check run when the workspace is publishable', async () => {
    const workspace = makeWorkspace({ isPackage: true });

    const check = buildWorkspaceCheck(workspace);

    await expect(Promise.resolve(check.skip?.())).resolves.toBe(false);
  });

  it('includes the scoped-name child only when the package name starts with @', () => {
    const scoped = buildWorkspaceCheck(makeWorkspace({ isPackage: true, name: '@scope/example' }));
    const unscoped = buildWorkspaceCheck(
      makeWorkspace({ isPackage: true, name: 'example', packageJson: { name: 'example' } }),
    );

    const scopedChildren = scoped.checks?.map((c) => c.name) ?? [];
    const unscopedChildren = unscoped.checks?.map((c) => c.name) ?? [];

    expect(scopedChildren).toContain('publishConfig.access is "public"');
    expect(unscopedChildren).not.toContain('publishConfig.access is "public"');
  });

  it('falls back to "(unnamed)" when the workspace has no name', () => {
    const workspace = makeWorkspace({ isPackage: true, name: undefined, packageJson: {} });

    const check = buildWorkspaceCheck(workspace);

    expect(check.name).toBe('(unnamed)');
  });
});

describe(classifyNpmAuth, () => {
  it('treats a zero exit as authenticated without reading the payload', () => {
    expect(classifyNpmAuth({ exitOk: true, stdout: 'anything at all' })).toStrictEqual({ status: 'authenticated' });
  });

  it('reports E401 as unauthenticated', () => {
    const status = classifyNpmAuth({ exitOk: false, stdout: WHOAMI_E401 });

    expect(status.status).toBe('unauthenticated');
    expect(status).toHaveProperty('detail', expect.stringContaining('E401'));
  });

  it('reports ENEEDAUTH as unauthenticated', () => {
    const stdout = '{"error":{"code":"ENEEDAUTH","summary":"This command requires you to be logged in."}}';

    expect(classifyNpmAuth({ exitOk: false, stdout }).status).toBe('unauthenticated');
  });

  it('reports a network failure as unreachable', () => {
    const stdout = '{"error":{"code":"ENOTFOUND","summary":"request to https://registry.npmjs.org failed"}}';
    const status = classifyNpmAuth({ exitOk: false, stdout });

    expect(status.status).toBe('unreachable');
    expect(status).toHaveProperty('detail', expect.stringContaining('ENOTFOUND'));
  });

  it('does not report an unrecognized error code as a missing login', () => {
    const stdout = '{"error":{"code":"E500","summary":"500 Internal Server Error"}}';
    const status = classifyNpmAuth({ exitOk: false, stdout });

    expect(status.status).toBe('unreachable');
    expect(status).toHaveProperty('detail', expect.stringContaining('500 Internal Server Error'));
  });

  it('reports an unreadable payload as unreachable', () => {
    expect(classifyNpmAuth({ exitOk: false, stdout: 'npm error code E401' }).status).toBe('unreachable');
  });
});

describe(classifyTrustQuery, () => {
  const configured = { type: 'github', repository: OWNER_REPO, file: WORKFLOW_FILE };

  it('reports a matching relationship as configured', () => {
    const result = classifyTrustQuery({ exitOk: true, stdout: JSON.stringify(configured) }, OWNER_REPO, WORKFLOW_FILE);

    expect(result).toStrictEqual({ status: 'configured' });
  });

  it('finds a match among several relationships', () => {
    const others = { type: 'gitlab', repository: 'elsewhere/other', file: 'release.yaml' };
    const result = classifyTrustQuery(
      { exitOk: true, stdout: JSON.stringify([others, configured]) },
      OWNER_REPO,
      WORKFLOW_FILE,
    );

    expect(result).toStrictEqual({ status: 'configured' });
  });

  it('reports a relationship pointing elsewhere as mismatched', () => {
    const elsewhere = { type: 'github', repository: 'someone/else', file: WORKFLOW_FILE };
    const result = classifyTrustQuery({ exitOk: true, stdout: JSON.stringify(elsewhere) }, OWNER_REPO, WORKFLOW_FILE);

    expect(result.status).toBe('mismatched');
    expect(result).toHaveProperty('detail', expect.stringContaining('someone/else'));
  });

  it('names the workflow file when it is the only field that differs', () => {
    const otherFile = { type: 'github', repository: OWNER_REPO, file: 'release.yaml' };
    const result = classifyTrustQuery({ exitOk: true, stdout: JSON.stringify(otherFile) }, OWNER_REPO, WORKFLOW_FILE);

    expect(result.status).toBe('mismatched');
    expect(result).toHaveProperty('detail', expect.stringContaining('release.yaml'));
  });

  it.each([
    ['an empty object', '{}'],
    ['an empty array', '[]'],
    ['an array of entries naming no relationship', '[{}]'],
  ])('reports %s as not configured', (_label, stdout) => {
    expect(classifyTrustQuery({ exitOk: true, stdout }, OWNER_REPO, WORKFLOW_FILE)).toStrictEqual({
      status: 'not-configured',
    });
  });

  it('reports E404 as not configured rather than as a failed query', () => {
    const stdout = '{"error":{"code":"E404","summary":"Not found"}}';

    expect(classifyTrustQuery({ exitOk: false, stdout }, OWNER_REPO, WORKFLOW_FILE)).toStrictEqual({
      status: 'not-configured',
    });
  });

  it('reports an authentication failure as a failed query, not as an unconfigured publisher', () => {
    const result = classifyTrustQuery({ exitOk: false, stdout: TRUST_E401 }, OWNER_REPO, WORKFLOW_FILE);

    expect(result.status).toBe('error');
    expect(result).toHaveProperty('detail', expect.stringContaining('E401'));
  });

  it.each([
    ['a failed query', false],
    ['a successful query', true],
  ])('reports an unreadable payload from %s as a failed query', (_label, exitOk) => {
    expect(classifyTrustQuery({ exitOk, stdout: '<html>502</html>' }, OWNER_REPO, WORKFLOW_FILE).status).toBe('error');
  });
});

describe('packagesChecklist', () => {
  // Read names only. Every check's `fix` is a getter, and the session precondition's queries the
  // registry, so touching one here would put a network call in a unit test.
  it('gates the checklist on a usable npm session', () => {
    const preconditionNames = packagesChecklist.preconditions?.map((precondition) => precondition.name) ?? [];

    expect(preconditionNames).toContain('npm session is usable');
  });
});
