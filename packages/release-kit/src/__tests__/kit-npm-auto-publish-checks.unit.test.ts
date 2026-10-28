import type { RdyCheck } from 'readyup';
import { makeWorkspace } from 'readyup/testing';
import { assert, describe, expect, it } from 'vitest';

import { buildWorkspaceCheck, skipIfNotPublishable } from '../../.readyup/kits/npm-auto-publish.ts';
import {
  classifyNpmAuth,
  classifyProvenanceSetting,
  classifyTrustCapability,
  classifyTrustQuery,
  describeNpmPackageLookup,
  describeTrustedPublisher,
  type OwnerRepo,
  parseGitHubOwnerRepo,
} from '../../.readyup/lib/npm-trust.ts';
import { listDeclaredChildren } from '../test-utils/listDeclaredChildren.ts';

// Verbatim payloads from npm 11.16.0. Both commands write the envelope to stdout and exit nonzero.
const WHOAMI_E401_STDOUT =
  '{"error":{"code":"E401","summary":"401 Unauthorized - GET https://registry.npmjs.org/-/whoami","detail":""}}';
const TRUST_E401_STDOUT = String.raw`{"error":{"code":"E401","summary":"401 Unauthorized - GET https://registry.npmjs.org/-/package/@williamthorsen%2frelease-kit/trust - {\"success\":false,\"error\":\"You must be logged in to publish packages.\"}","detail":""}}`;
const TRUST_EOTP_STDOUT =
  '{"error":{"code":"EOTP","summary":"This operation requires a one-time password.","detail":"Enter one with your authenticator app."}}';

const OWNER_REPO = 'williamthorsen/node-monorepo-tools';
const RESOLVED_REPO: OwnerRepo = { ok: true, value: OWNER_REPO };
const UNRESOLVED_REPO: OwnerRepo = { ok: false, detail: 'The repo does not have a readable origin remote' };
const NO_GITHUB_REMOTE_FIX = 'Add an origin remote that points to the GitHub repo, then run this check again';
const WORKFLOW_FILE = 'publish.yaml';

const NO_PROVENANCE_WORKFLOW_CONTENT = 'jobs:\n  publish:\n    steps:\n      - run: npm publish\n';
const PROVENANCE_WORKFLOW_CONTENT = `${NO_PROVENANCE_WORKFLOW_CONTENT}        with:\n          provenance: true\n`;

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

    const childNames = listDeclaredChildren(check).map((c) => c.name);
    expect(childNames).not.toContain('not marked private');
  });

  it('lets the parent check run when the workspace is publishable', async () => {
    const workspace = makeWorkspace({ isPackage: true });

    const check = buildWorkspaceCheck(workspace);

    await expect(Promise.resolve(check.skip?.())).resolves.toBe(false);
  });

  // The gate reports a session that cannot answer trust queries; the per-package rows skip rather than repeating a
  // query whose answer is already known. Both registry-reading checks declare a predicate of their own, because the
  // rows are not nested beneath the gate.
  it('gives both registry-reading checks a skip predicate', () => {
    const publishedCheck = findCheck(
      'published to npm',
      listDeclaredChildren(buildWorkspaceCheck(makeWorkspace({ isPackage: true }))),
    );

    expect(publishedCheck.skip).toBeDefined();
    expect(findCheck('trusted publisher configured', listDeclaredChildren(publishedCheck)).skip).toBeDefined();
  });

  // Asserted against the property descriptor because readyup reads `fix` while it loads the kit, so an accessor runs
  // before any `skip` can guard it.
  it('declares the trusted-publisher fix as a value, not an accessor', () => {
    const publishedCheck = findCheck(
      'published to npm',
      listDeclaredChildren(buildWorkspaceCheck(makeWorkspace({ isPackage: true, name: '@scope/example' }))),
    );
    const descriptor = Object.getOwnPropertyDescriptor(
      findCheck('trusted publisher configured', listDeclaredChildren(publishedCheck)),
      'fix',
    );

    expect(descriptor?.value).toBe('Run: npm trust github @scope/example --repo <owner>/<repo> --file publish.yaml');
  });

  it('includes the scoped-name child only when the package name starts with @', () => {
    const scopedCheck = buildWorkspaceCheck(makeWorkspace({ isPackage: true, name: '@scope/example' }));
    const unscopedCheck = buildWorkspaceCheck(
      makeWorkspace({ isPackage: true, name: 'example', packageJson: { name: 'example' } }),
    );

    const scopedChildren = listDeclaredChildren(scopedCheck).map((c) => c.name);
    const unscopedChildren = listDeclaredChildren(unscopedCheck).map((c) => c.name);

    expect(scopedChildren).toContain('publishConfig.access is "public"');
    expect(unscopedChildren).not.toContain('publishConfig.access is "public"');
  });

  it('falls back to "(unnamed)" when the workspace does not have a name', () => {
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
    const authStatus = classifyNpmAuth({ exitOk: false, stdout: WHOAMI_E401_STDOUT });

    expect(authStatus.status).toBe('unauthenticated');
    expect(authStatus).toHaveProperty('detail', expect.stringContaining('E401'));
  });

  it('reports ENEEDAUTH as unauthenticated', () => {
    const stdout = '{"error":{"code":"ENEEDAUTH","summary":"This command requires you to be logged in."}}';

    expect(classifyNpmAuth({ exitOk: false, stdout }).status).toBe('unauthenticated');
  });

  it('reports a network failure as unreachable', () => {
    const stdout = '{"error":{"code":"ENOTFOUND","summary":"request to https://registry.npmjs.org failed"}}';
    const authStatus = classifyNpmAuth({ exitOk: false, stdout });

    expect(authStatus.status).toBe('unreachable');
    expect(authStatus).toHaveProperty('detail', expect.stringContaining('ENOTFOUND'));
  });

  it('does not report an unrecognized error code as a missing login', () => {
    const stdout = '{"error":{"code":"E500","summary":"500 Internal Server Error"}}';
    const authStatus = classifyNpmAuth({ exitOk: false, stdout });

    expect(authStatus.status).toBe('unreachable');
    expect(authStatus).toHaveProperty('detail', expect.stringContaining('500 Internal Server Error'));
  });

  it('reports an unreadable payload as unreachable', () => {
    expect(classifyNpmAuth({ exitOk: false, stdout: 'npm error code E401' }).status).toBe('unreachable');
  });
});

describe(classifyProvenanceSetting, () => {
  it('reports an unreadable workflow ahead of an unreportable visibility', () => {
    const outcome = classifyProvenanceSetting(undefined, 'unknown');

    expect(outcome.detail).toBe('Cannot read .github/workflows/publish.yaml');
    expect(outcome.fix).toBe("Check the file's permissions");
  });

  it('reports an unreadable workflow ahead of an unidentified repo', () => {
    expect(classifyProvenanceSetting(undefined, UNRESOLVED_REPO).detail).toBe(
      'Cannot read .github/workflows/publish.yaml',
    );
  });

  it('reports an unidentified repo with the remote fix rather than the GitHub CLI fix', () => {
    expect(classifyProvenanceSetting(PROVENANCE_WORKFLOW_CONTENT, UNRESOLVED_REPO)).toStrictEqual({
      ok: false,
      detail: 'The repo does not have a readable origin remote',
      fix: NO_GITHUB_REMOTE_FIX,
    });
  });

  it('reports an unreportable visibility', () => {
    const outcome = classifyProvenanceSetting(PROVENANCE_WORKFLOW_CONTENT, 'unknown');

    expect(outcome.detail).toBe("The GitHub CLI could not report the repo's visibility");
    expect(outcome.fix).toBe('Install and authenticate the GitHub CLI: gh auth login');
  });

  it('reports a public repo whose workflow omits provenance', () => {
    const outcome = classifyProvenanceSetting(NO_PROVENANCE_WORKFLOW_CONTENT, 'public');

    expect(outcome.detail).toBe('The repo is public and publish.yaml does not set provenance: true');
    expect(outcome.fix).toBe(
      'Set provenance: true in .github/workflows/publish.yaml; public repos should generate provenance attestations',
    );
  });

  it('reports a private repo whose workflow sets provenance', () => {
    const outcome = classifyProvenanceSetting(PROVENANCE_WORKFLOW_CONTENT, 'private');

    expect(outcome.detail).toBe('The repo is private and publish.yaml sets provenance: true');
    expect(outcome.fix).toBe('Make the GitHub repo public; OIDC publishing with provenance requires a public repo');
  });

  it('passes a public repo whose workflow sets provenance', () => {
    expect(classifyProvenanceSetting(PROVENANCE_WORKFLOW_CONTENT, 'public')).toStrictEqual({ ok: true });
  });

  it('passes a private repo whose workflow omits provenance', () => {
    expect(classifyProvenanceSetting(NO_PROVENANCE_WORKFLOW_CONTENT, 'private')).toStrictEqual({ ok: true });
  });
});

describe(classifyTrustCapability, () => {
  it('reports an unauthenticated session as incapable, including its detail', () => {
    const authStatus = classifyNpmAuth({ exitOk: false, stdout: WHOAMI_E401_STDOUT });

    expect(classifyTrustCapability(authStatus, undefined)).toStrictEqual({
      ok: false,
      detail: expect.stringContaining('E401'),
    });
  });

  it('reports an unanswerable probe as incapable, including the probe detail', () => {
    const probeResult = classifyTrustQuery({ exitOk: false, stdout: TRUST_EOTP_STDOUT }, RESOLVED_REPO, WORKFLOW_FILE);

    expect(classifyTrustCapability({ status: 'authenticated' }, probeResult)).toStrictEqual({
      ok: false,
      detail: expect.stringContaining('one-time password'),
    });
  });

  it.each([
    ['a configured publisher', { status: 'configured' } as const],
    ['no publisher at all', { status: 'not-configured' } as const],
    ['a package-specific failure', { status: 'error', detail: 'The npm trust query failed (E500): ' } as const],
  ])('probeResult', (_label, probe) => {
    expect(classifyTrustCapability({ status: 'authenticated' }, probe)).toStrictEqual({ ok: true });
  });

  // A repo that does not name any workspace has nothing to probe with, which leaves the session's capability
  // undisproved.
  it('reports an authenticated session without a probe as capable', () => {
    expect(classifyTrustCapability({ status: 'authenticated' }, undefined)).toStrictEqual({ ok: true });
  });
});

describe(classifyTrustQuery, () => {
  const configuredRelationship = { type: 'github', repository: OWNER_REPO, file: WORKFLOW_FILE };

  it('reports a matching relationship as configured', () => {
    const result = classifyTrustQuery(
      { exitOk: true, stdout: JSON.stringify(configuredRelationship) },
      RESOLVED_REPO,
      WORKFLOW_FILE,
    );

    expect(result).toStrictEqual({ status: 'configured' });
  });

  it('finds a match among several relationships', () => {
    const otherRelationship = { type: 'gitlab', repository: 'elsewhere/other', file: 'release.yaml' };
    const result = classifyTrustQuery(
      { exitOk: true, stdout: JSON.stringify([otherRelationship, configuredRelationship]) },
      RESOLVED_REPO,
      WORKFLOW_FILE,
    );

    expect(result).toStrictEqual({ status: 'configured' });
  });

  it('reports a relationship pointing elsewhere as mismatched', () => {
    const elsewhereRelationship = { type: 'github', repository: 'someone/else', file: WORKFLOW_FILE };
    const result = classifyTrustQuery(
      { exitOk: true, stdout: JSON.stringify(elsewhereRelationship) },
      RESOLVED_REPO,
      WORKFLOW_FILE,
    );

    expect(result.status).toBe('mismatched');
    expect(result).toHaveProperty('detail', expect.stringContaining('someone/else'));
  });

  it('names the workflow file when it is the only field that differs', () => {
    const otherFileRelationship = { type: 'github', repository: OWNER_REPO, file: 'release.yaml' };
    const result = classifyTrustQuery(
      { exitOk: true, stdout: JSON.stringify(otherFileRelationship) },
      RESOLVED_REPO,
      WORKFLOW_FILE,
    );

    expect(result.status).toBe('mismatched');
    expect(result).toHaveProperty('detail', expect.stringContaining('release.yaml'));
  });

  it('reports a relationship as a failed query when the repo is unidentified', () => {
    const result = classifyTrustQuery(
      { exitOk: true, stdout: JSON.stringify(configuredRelationship) },
      UNRESOLVED_REPO,
      WORKFLOW_FILE,
    );

    expect(result.status).toBe('error');
    expect(result).toHaveProperty('detail', expect.stringContaining(OWNER_REPO));
  });

  it('reports a missing relationship as not configured when the repo is unidentified', () => {
    expect(classifyTrustQuery({ exitOk: true, stdout: '[]' }, UNRESOLVED_REPO, WORKFLOW_FILE)).toStrictEqual({
      status: 'not-configured',
    });
  });

  it.each([
    ['an empty object', '{}'],
    ['an empty array', '[]'],
    ['an array of entries naming no relationship', '[{}]'],
  ])('reports %s as not configured', (_label, stdout) => {
    expect(classifyTrustQuery({ exitOk: true, stdout }, RESOLVED_REPO, WORKFLOW_FILE)).toStrictEqual({
      status: 'not-configured',
    });
  });

  it('reports E404 as not configured rather than as a failed query', () => {
    const stdout = '{"error":{"code":"E404","summary":"Not found"}}';

    expect(classifyTrustQuery({ exitOk: false, stdout }, RESOLVED_REPO, WORKFLOW_FILE)).toStrictEqual({
      status: 'not-configured',
    });
  });

  it('reports an authentication failure as unanswerable, not as an unconfigured publisher', () => {
    const result = classifyTrustQuery({ exitOk: false, stdout: TRUST_E401_STDOUT }, RESOLVED_REPO, WORKFLOW_FILE);

    expect(result.status).toBe('unanswerable');
    expect(result).toHaveProperty('detail', expect.stringContaining('E401'));
  });

  it('reports a missing one-time password as unanswerable', () => {
    const result = classifyTrustQuery({ exitOk: false, stdout: TRUST_EOTP_STDOUT }, RESOLVED_REPO, WORKFLOW_FILE);

    expect(result.status).toBe('unanswerable');
    expect(result).toHaveProperty('detail', expect.stringContaining('one-time password'));
  });

  it('reports a missing login as unanswerable', () => {
    const stdout = '{"error":{"code":"ENEEDAUTH","summary":"This command requires you to be logged in."}}';

    expect(classifyTrustQuery({ exitOk: false, stdout }, RESOLVED_REPO, WORKFLOW_FILE).status).toBe('unanswerable');
  });

  it('reports a network failure as unanswerable', () => {
    const stdout = '{"error":{"code":"ENOTFOUND","summary":"request to https://registry.npmjs.org failed"}}';
    const result = classifyTrustQuery({ exitOk: false, stdout }, RESOLVED_REPO, WORKFLOW_FILE);

    expect(result.status).toBe('unanswerable');
    expect(result).toHaveProperty('detail', expect.stringContaining('ENOTFOUND'));
  });

  it('reports an unrecognized error code as a failed query rather than as unanswerable', () => {
    const stdout = '{"error":{"code":"E500","summary":"500 Internal Server Error"}}';

    expect(classifyTrustQuery({ exitOk: false, stdout }, RESOLVED_REPO, WORKFLOW_FILE).status).toBe('error');
  });

  it.each([
    ['a failed query', false],
    ['a successful query', true],
  ])('reports an unreadable payload from %s as a failed query', (_label, exitOk) => {
    expect(classifyTrustQuery({ exitOk, stdout: '<html>502</html>' }, RESOLVED_REPO, WORKFLOW_FILE).status).toBe(
      'error',
    );
  });
});

describe(describeNpmPackageLookup, () => {
  it('passes for a published package', () => {
    expect(describeNpmPackageLookup({ status: 'published' })).toStrictEqual({ ok: true });
  });

  it("fails without its own fix for an unpublished package, so that the row's bootstrap fix applies", () => {
    expect(describeNpmPackageLookup({ status: 'unpublished' })).toStrictEqual({
      ok: false,
      detail: 'The npm registry does not list this package',
    });
  });

  it('fails with a registry-access fix when the lookup could not be answered', () => {
    expect(
      describeNpmPackageLookup({ status: 'unverifiable', detail: 'Cannot reach the npm registry (ENOTFOUND)' }),
    ).toStrictEqual({
      ok: false,
      detail: 'Cannot reach the npm registry (ENOTFOUND)',
      fix: 'Restore access to the npm registry, then run this check again',
    });
  });
});

describe(describeTrustedPublisher, () => {
  it('passes for a configured publisher', () => {
    expect(describeTrustedPublisher({ status: 'configured' }, '@scope/example', UNRESOLVED_REPO)).toStrictEqual({
      ok: true,
    });
  });

  it('names the npm trust command for this repo when no publisher is configured', () => {
    expect(describeTrustedPublisher({ status: 'not-configured' }, '@scope/example', RESOLVED_REPO)).toStrictEqual({
      ok: false,
      detail: 'The npm registry does not list any trusted publisher for this package',
      fix: `Run: npm trust github @scope/example --repo ${OWNER_REPO} --file publish.yaml`,
    });
  });

  it('keeps the query detail of a mismatched publisher beside the npm trust command', () => {
    const outcome = describeTrustedPublisher(
      { status: 'mismatched', detail: 'Expected github a/b (publish.yaml); found github c/d (publish.yaml)' },
      '@scope/example',
      RESOLVED_REPO,
    );

    expect(outcome.detail).toBe('Expected github a/b (publish.yaml); found github c/d (publish.yaml)');
    expect(outcome.fix).toBe(`Run: npm trust github @scope/example --repo ${OWNER_REPO} --file publish.yaml`);
  });

  it('names the unidentified repo and advises adding the remote that the command needs', () => {
    expect(describeTrustedPublisher({ status: 'not-configured' }, '@scope/example', UNRESOLVED_REPO)).toStrictEqual({
      ok: false,
      detail:
        'The npm registry does not list any trusted publisher for this package. The repo does not have a readable origin remote',
      fix: NO_GITHUB_REMOTE_FIX,
    });
  });
});

describe(parseGitHubOwnerRepo, () => {
  it.each([
    ['an SSH URL', 'git@github.com:owner/repo.git'],
    ['an SSH URL without .git', 'git@github.com:owner/repo'],
    ['an HTTPS URL', 'https://github.com/owner/repo.git'],
    ['an HTTPS URL without .git', 'https://github.com/owner/repo'],
  ])('reads owner/repo from %s', (_label, url) => {
    expect(parseGitHubOwnerRepo(url)).toStrictEqual({ ok: true, value: 'owner/repo' });
  });

  it('reports a remote that is not on GitHub', () => {
    expect(parseGitHubOwnerRepo('git@gitlab.com:owner/repo.git')).toStrictEqual({
      ok: false,
      detail: 'The origin remote does not point to GitHub: git@gitlab.com:owner/repo.git',
    });
  });
});

// region | Helpers

/** Finds a check by name among `siblingChecks`. */
function findCheck(name: string, siblingChecks: readonly RdyCheck[]): RdyCheck {
  const check = siblingChecks.find((candidate) => candidate.name === name);
  assert(check, `Expected a "${name}" check`);
  return check;
}

// endregion | Helpers
