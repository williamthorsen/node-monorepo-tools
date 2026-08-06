import { isFlatChecklist, type RdyCheck, type RdyChecklist } from 'readyup';
import type { DiscoverWorkspacesOptions, Workspace } from 'readyup/check-utils';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';

const { mockedDiscoverWorkspaces } = vi.hoisted(() => ({
  mockedDiscoverWorkspaces: vi.fn<(options?: DiscoverWorkspacesOptions) => Workspace[]>(),
}));

vi.mock(import('readyup/check-utils'), async (importOriginal) => {
  const actual = await importOriginal<typeof import('readyup/check-utils')>();
  return {
    ...actual,
    discoverWorkspaces: mockedDiscoverWorkspaces,
  };
});

import kit, {
  buildWorkspaceCheck,
  classifyNpmAuth,
  classifyTrustQuery,
  packagesChecklist,
  skipIfNothingPublishable,
  skipIfNotPublishable,
} from '../../.readyup/kits/npm-auto-publish.ts';

// Verbatim payloads from npm 11.16.0. Both commands write the envelope to stdout and exit nonzero.
const WHOAMI_E401 =
  '{"error":{"code":"E401","summary":"401 Unauthorized - GET https://registry.npmjs.org/-/whoami","detail":""}}';
const TRUST_E401 = String.raw`{"error":{"code":"E401","summary":"401 Unauthorized - GET https://registry.npmjs.org/-/package/@williamthorsen%2frelease-kit/trust - {\"success\":false,\"error\":\"You must be logged in to publish packages.\"}","detail":""}}`;

const OWNER_REPO = 'williamthorsen/node-monorepo-tools';
const WORKFLOW_FILE = 'publish.yaml';

describe(skipIfNothingPublishable, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when at least one workspace is publishable', () => {
    mockWorkspaces([makeWorkspace({ isPackage: false }), makeWorkspace({ isPackage: true })]);

    expect(skipIfNothingPublishable()).toBe(false);
  });

  it('returns the skip reason when every workspace is private', () => {
    mockWorkspaces([makeWorkspace({ isPackage: false }), makeWorkspace({ isPackage: false })]);

    expect(skipIfNothingPublishable()).toBe('no publishable packages');
  });

  it('returns the skip reason when no workspace is discovered', () => {
    mockWorkspaces([]);

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

// Both checklists stand down when the repo publishes nothing. Readyup runs, reports, and counts nothing beneath a
// check whose `skip` fires, so each checklist's substantive work has to hang beneath one gate.
describe('repo checklist', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs publish.yaml exists as a check rather than a precondition', () => {
    const checklist = findChecklist('repo');

    expect(checklist.preconditions).toBeUndefined();
    expect(checklist.checks.map((check) => check.name)).toStrictEqual(['publish.yaml exists']);
  });

  it('skips publish.yaml exists when the repo publishes nothing', () => {
    mockWorkspaces([makeWorkspace({ isPackage: false })]);

    expect(findCheck('publish.yaml exists', findChecklist('repo').checks).skip?.()).toBe('no publishable packages');
  });

  it('runs publish.yaml exists when the repo publishes something', () => {
    mockWorkspaces([makeWorkspace({ isPackage: true })]);

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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps only the preconditions that read local files', () => {
    const preconditionNames = packagesChecklist.preconditions?.map((precondition) => precondition.name);

    expect(preconditionNames).toStrictEqual([
      'packageManager field starts with "pnpm"',
      'At least one workspace discovered',
    ]);
  });

  it('runs the npm session check as a check rather than a precondition', () => {
    expect(packagesChecklist.checks.map((check) => check.name)).toStrictEqual(['npm session is usable']);
  });

  it('skips the npm session check when the repo publishes nothing', () => {
    mockWorkspaces([makeWorkspace({ isPackage: false })]);

    expect(findCheck('npm session is usable', packagesChecklist.checks).skip?.()).toBe('no publishable packages');
  });

  it('runs the npm session check when the repo publishes something', () => {
    mockWorkspaces([makeWorkspace({ isPackage: true })]);

    expect(findCheck('npm session is usable', packagesChecklist.checks).skip?.()).toBe(false);
  });

  // Read names only: the per-workspace `trusted publisher configured` check declares `fix` as a getter that shells
  // out to git, so touching one here would put a subprocess in a unit test.
  it('hangs a check for every discovered workspace beneath the npm session check', () => {
    mockWorkspaces([
      makeWorkspace({ isPackage: true, name: '@scope/published' }),
      makeWorkspace({ isPackage: false, name: '@scope/private' }),
    ]);

    const gate = findCheck('npm session is usable', packagesChecklist.checks);

    expect(gate.checks?.map((check) => check.name)).toStrictEqual(['@scope/published', '@scope/private']);
  });
});

// region | Helpers

/** Finds a check by name among `siblings`, asserting it exists so a rename fails loudly. */
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

/** Builds a minimal Workspace-shaped fixture. */
function makeWorkspace(overrides: Partial<Workspace> & Pick<Workspace, 'isPackage'>): Workspace {
  return {
    dir: 'packages/example',
    absolutePath: '/repo/packages/example',
    name: '@scope/example',
    packageJson: { name: '@scope/example' },
    ...overrides,
  };
}

/** Makes `discoverWorkspaces` yield the given workspaces, honoring the filter its callers pass. */
function mockWorkspaces(workspaces: Workspace[]): void {
  mockedDiscoverWorkspaces.mockImplementation((options) =>
    workspaces.filter((workspace) => options?.filter?.(workspace) ?? true),
  );
}

// endregion | Helpers
