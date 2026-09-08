import { isFlatChecklist, type RdyCheck, type RdyChecklist } from 'readyup';
import { discoverWorkspaces } from 'readyup/check-utils';
import { makeWorkspace } from 'readyup/testing';
import { assert, describe, expect, it } from 'vitest';

import kit, {
  buildWorkspaceCheck,
  classifyNpmAuth,
  classifyTrustCapability,
  classifyTrustQuery,
  packagesChecklist,
  selectProbeName,
  skipIfNothingPublishable,
  skipIfNotPublishable,
} from '../../.readyup/kits/npm-auto-publish.ts';
import { PNPM_WORKSPACE, scaffoldRepo } from '../test-utils/scaffoldRepo.ts';

// Verbatim payloads from npm 11.16.0. Both commands write the envelope to stdout and exit nonzero.
const WHOAMI_E401 =
  '{"error":{"code":"E401","summary":"401 Unauthorized - GET https://registry.npmjs.org/-/whoami","detail":""}}';
const TRUST_E401 = String.raw`{"error":{"code":"E401","summary":"401 Unauthorized - GET https://registry.npmjs.org/-/package/@williamthorsen%2frelease-kit/trust - {\"success\":false,\"error\":\"You must be logged in to publish packages.\"}","detail":""}}`;
const TRUST_EOTP =
  '{"error":{"code":"EOTP","summary":"This operation requires a one-time password.","detail":"Enter one with your authenticator app."}}';

const OWNER_REPO = 'williamthorsen/node-monorepo-tools';
const SESSION_GATE = 'npm session can answer trust queries';
const WORKFLOW_FILE = 'publish.yaml';

// Repo shapes the discovery-dependent tests scaffold. Discovery reports the root alongside the members and returns
// the matched directories sorted, which is the order every assertion below reads.
const MONOREPO_PUBLISHING_NOTHING = {
  'package.json': '{"name":"monorepo","private":true}',
  'pnpm-workspace.yaml': PNPM_WORKSPACE,
  'packages/private/package.json': '{"name":"@scope/private","private":true}',
};

const MONOREPO_WITH_PRIVATE_ROOT = {
  'package.json': '{"name":"monorepo","private":true}',
  'pnpm-workspace.yaml': PNPM_WORKSPACE,
  'packages/private/package.json': '{"name":"@scope/private","private":true}',
  'packages/published/package.json': '{"name":"@scope/published"}',
};

// A single-package repo declares no workspace globs, so its only entry is the root, here a publishable one.
const SINGLE_PACKAGE_REPO = { 'package.json': '{"name":"single-package"}' };

describe(selectProbeName, () => {
  // The private member sorts first, so a checklist-membership filter would have picked it. Its row is skipped,
  // which would leave the probe's memoized answer unread and the round-trip unpaid for.
  it('passes over a private member that sorts ahead of a publishable one', () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);

    expect(selectProbeName()).toBe('@scope/published');
  });

  it('names a publishable repo root', () => {
    scaffoldRepo(SINGLE_PACKAGE_REPO);

    expect(selectProbeName()).toBe('single-package');
  });

  it('names nothing when every workspace is private', () => {
    scaffoldRepo(MONOREPO_PUBLISHING_NOTHING);

    expect(selectProbeName()).toBeUndefined();
  });
});

describe(skipIfNothingPublishable, () => {
  it('returns false when at least one workspace is publishable', () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);

    expect(skipIfNothingPublishable()).toBe(false);
  });

  // Discovery reports the root, so the private-root monorepo is the closest a repo comes to an empty list:
  // The list is never empty, and every entry in it is private.
  it('returns the skip reason when every workspace is private, the root included', () => {
    scaffoldRepo(MONOREPO_PUBLISHING_NOTHING);

    expect(skipIfNothingPublishable()).toBe('no publishable packages');
  });
});

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

  // The gate is what reports a session that cannot answer trust queries; the per-package rows stand down rather
  // than repeating a query whose answer is already known. Both registry-reading checks carry a predicate of their
  // own, because the rows no longer hang beneath the gate.
  it('gives both registry-reading checks a skip predicate', () => {
    const publishedCheck = findCheck(
      'published to npm',
      buildWorkspaceCheck(makeWorkspace({ isPackage: true })).checks ?? [],
    );

    expect(publishedCheck.skip).toBeDefined();
    expect(findCheck('trusted publisher configured', publishedCheck.checks ?? []).skip).toBeDefined();
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

describe(classifyTrustCapability, () => {
  it('reports an unauthenticated session as incapable, carrying its detail', () => {
    const auth = classifyNpmAuth({ exitOk: false, stdout: WHOAMI_E401 });

    expect(classifyTrustCapability(auth, undefined)).toStrictEqual({
      ok: false,
      detail: expect.stringContaining('E401'),
    });
  });

  it('reports an unanswerable probe as incapable, carrying the probe detail', () => {
    const probe = classifyTrustQuery({ exitOk: false, stdout: TRUST_EOTP }, OWNER_REPO, WORKFLOW_FILE);

    expect(classifyTrustCapability({ status: 'authenticated' }, probe)).toStrictEqual({
      ok: false,
      detail: expect.stringContaining('one-time password'),
    });
  });

  it.each([
    ['a configured publisher', { status: 'configured' } as const],
    ['no publisher at all', { status: 'not-configured' } as const],
    ['a package-specific failure', { status: 'error', detail: 'The npm trust query failed (E500): ' } as const],
  ])('reports an authenticated session whose probe found %s as capable', (_label, probe) => {
    expect(classifyTrustCapability({ status: 'authenticated' }, probe)).toStrictEqual({ ok: true });
  });

  // A repo naming no workspace has nothing to probe with, which leaves the session's capability undisproved.
  it('reports an authenticated session with no probe as capable', () => {
    expect(classifyTrustCapability({ status: 'authenticated' }, undefined)).toStrictEqual({ ok: true });
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

  it('reports an authentication failure as unanswerable, not as an unconfigured publisher', () => {
    const result = classifyTrustQuery({ exitOk: false, stdout: TRUST_E401 }, OWNER_REPO, WORKFLOW_FILE);

    expect(result.status).toBe('unanswerable');
    expect(result).toHaveProperty('detail', expect.stringContaining('E401'));
  });

  it('reports a missing one-time password as unanswerable', () => {
    const result = classifyTrustQuery({ exitOk: false, stdout: TRUST_EOTP }, OWNER_REPO, WORKFLOW_FILE);

    expect(result.status).toBe('unanswerable');
    expect(result).toHaveProperty('detail', expect.stringContaining('one-time password'));
  });

  it('reports a missing login as unanswerable', () => {
    const stdout = '{"error":{"code":"ENEEDAUTH","summary":"This command requires you to be logged in."}}';

    expect(classifyTrustQuery({ exitOk: false, stdout }, OWNER_REPO, WORKFLOW_FILE).status).toBe('unanswerable');
  });

  it('reports a network failure as unanswerable', () => {
    const stdout = '{"error":{"code":"ENOTFOUND","summary":"request to https://registry.npmjs.org failed"}}';
    const result = classifyTrustQuery({ exitOk: false, stdout }, OWNER_REPO, WORKFLOW_FILE);

    expect(result.status).toBe('unanswerable');
    expect(result).toHaveProperty('detail', expect.stringContaining('ENOTFOUND'));
  });

  it('reports an unrecognized error code as a failed query rather than as unanswerable', () => {
    const stdout = '{"error":{"code":"E500","summary":"500 Internal Server Error"}}';

    expect(classifyTrustQuery({ exitOk: false, stdout }, OWNER_REPO, WORKFLOW_FILE).status).toBe('error');
  });

  it.each([
    ['a failed query', false],
    ['a successful query', true],
  ])('reports an unreadable payload from %s as a failed query', (_label, exitOk) => {
    expect(classifyTrustQuery({ exitOk, stdout: '<html>502</html>' }, OWNER_REPO, WORKFLOW_FILE).status).toBe('error');
  });
});

// Both checklists stand down when the repo publishes nothing. Readyup runs, reports, and counts nothing beneath a
// check whose `skip` fires, so each checklist's substantive work has to hang beneath one gate.
describe('repo checklist', () => {
  it('runs publish.yaml exists as a check rather than a precondition', () => {
    const checklist = findChecklist('repo');

    expect(checklist.preconditions).toBeUndefined();
    expect(checklist.checks.map((check) => check.name)).toStrictEqual(['publish.yaml exists']);
  });

  it('skips publish.yaml exists when the repo publishes nothing', () => {
    scaffoldRepo(MONOREPO_PUBLISHING_NOTHING);

    expect(findCheck('publish.yaml exists', findChecklist('repo').checks).skip?.()).toBe('no publishable packages');
  });

  it('runs publish.yaml exists when the repo publishes something', () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);

    expect(findCheck('publish.yaml exists', findChecklist('repo').checks).skip?.()).toBe(false);
  });

  it('hangs the workflow-content checks beneath publish.yaml exists', () => {
    const gate = findCheck('publish.yaml exists', findChecklist('repo').checks);

    expect(gate.checks?.map((check) => check.name)).toStrictEqual([
      'id-token: write permission declared',
      'No legacy token references in workflow files',
      'Provenance setting matches repo visibility',
    ]);
  });
});

describe('packages checklist', () => {
  it('keeps only the preconditions that read local files', () => {
    const preconditionNames = packagesChecklist.preconditions?.map((precondition) => precondition.name);

    expect(preconditionNames).toStrictEqual([
      'packageManager field starts with "pnpm"',
      'At least one workspace discovered',
    ]);
  });

  it('runs the npm session gate as a check rather than a precondition', () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);

    expect(packagesChecklist.preconditions?.map((precondition) => precondition.name)).not.toContain(SESSION_GATE);
    expect(packagesChecklist.checks[0]?.name).toBe(SESSION_GATE);
  });

  it('reports the gate alone when the repo publishes nothing', () => {
    scaffoldRepo(MONOREPO_PUBLISHING_NOTHING);

    expect(packagesChecklist.checks.map((check) => check.name)).toStrictEqual([SESSION_GATE]);
    expect(findCheck(SESSION_GATE, packagesChecklist.checks).skip?.()).toBe('no publishable packages');
  });

  it('runs the npm session gate when the repo publishes something', () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);

    expect(findCheck(SESSION_GATE, packagesChecklist.checks).skip?.()).toBe(false);
  });

  it('hangs no check beneath the npm session gate', () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);

    expect(findCheck(SESSION_GATE, packagesChecklist.checks).checks).toBeUndefined();
  });

  // Asserted against the property descriptor because readyup takes outcome-specific wording in `detail` rather
  // than in a `fix` that varies with what the check found.
  it('declares the npm session fix as a value, not an accessor', () => {
    const descriptor = Object.getOwnPropertyDescriptor(findCheck(SESSION_GATE, packagesChecklist.checks), 'fix');

    expect(descriptor?.value).toBeTypeOf('string');
  });

  // Read names only: The per-workspace `trusted publisher configured` check declares `fix` as a getter that shells
  // out to git. A private member keeps its row. A private root does not: The row is what reports the workspace
  // as skipped, and the root is not a workspace a consumer wrote.
  it('lists a check for every discovered member beside the npm session gate', () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);

    expect(packagesChecklist.checks.map((check) => check.name)).toStrictEqual([
      SESSION_GATE,
      '@scope/private',
      '@scope/published',
    ]);
  });

  it('lists no check for a private repo root', () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);

    // Read the unfiltered list first, so the root's absence below is the filter's doing rather than the tree's.
    expect(discoverWorkspaces().map((workspace) => workspace.name)).toContain('monorepo');
    expect(packagesChecklist.checks.map((check) => check.name)).not.toContain('monorepo');
  });

  it('lists the full workspace check for a publishable repo root', () => {
    scaffoldRepo(SINGLE_PACKAGE_REPO);

    expect(packagesChecklist.checks.map((check) => check.name)).toStrictEqual([SESSION_GATE, 'single-package']);
    expect(packagesChecklist.checks[1]?.checks?.map((check) => check.name)).toStrictEqual([
      'repository field exists',
      'published to npm',
      'files field exists',
    ]);
  });
});

// region | Helpers

/** Finds a check by name among `siblings`. */
function findCheck(name: string, siblings: RdyCheck[]): RdyCheck {
  const check = siblings.find((candidate) => candidate.name === name);
  assert(check, `Expected a "${name}" check`);
  return check;
}

/** Returns the named checklist from the kit, asserting it is flat so a staged form fails loudly. */
function findChecklist(name: string): RdyChecklist {
  const checklist = kit.checklists.find((candidate) => candidate.name === name);
  assert(checklist && isFlatChecklist(checklist), `Expected the kit to carry a flat "${name}" checklist`);
  return checklist;
}

// endregion | Helpers
