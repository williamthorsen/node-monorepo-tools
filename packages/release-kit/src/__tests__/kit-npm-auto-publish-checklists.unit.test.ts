import { isFlatChecklist, type RdyCheck, type RdyChecklist } from 'readyup';
import { discoverWorkspaces } from 'readyup/check-utils';
import { assert, describe, expect, it } from 'vitest';

import kit, {
  packagesChecklist,
  selectProbeName,
  skipIfNothingPublishable,
} from '../../.readyup/kits/npm-auto-publish.ts';
import { listDeclaredChildren } from '../test-utils/listDeclaredChildren.ts';
import { PNPM_WORKSPACE, scaffoldRepo } from '../test-utils/scaffoldRepo.ts';

const PACKAGES_PARENT = 'Repo publishes at least one package';
const SESSION_GATE = 'npm session can answer trust queries';

// Repo shapes that the discovery-dependent tests scaffold. Discovery reports the root alongside the members and returns
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

// A single-package repo does not declare any workspace globs, so its only entry is the root, here a publishable one.
const SINGLE_PACKAGE_REPO = { 'package.json': '{"name":"single-package"}' };

describe(selectProbeName, () => {
  // Because the private member sorts first, a checklist-membership filter would have picked it. Its row is skipped,
  // which would leave the probe's memoized answer unread and the round trip wasted.
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

// Both checklists skip when the repo publishes nothing. Readyup runs, reports, and counts nothing beneath a check
// whose `skip` fires, so each checklist's substantive work has to be nested beneath one gate.
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

  it('nests the workflow-content checks beneath publish.yaml exists', () => {
    const gate = findCheck('publish.yaml exists', findChecklist('repo').checks);

    expect(listDeclaredChildren(gate).map((check) => check.name)).toStrictEqual([
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

  it('declares one parent check, beneath which every other check is built', () => {
    expect(packagesChecklist.checks.map((check) => check.name)).toStrictEqual([PACKAGES_PARENT]);
    expect(findCheck(PACKAGES_PARENT, packagesChecklist.checks).checks).toBeTypeOf('function');
  });

  // `rdy compile` records these names in the published manifest, so they must not vary with the directory from which
  // the kit is imported.
  it('declares the same check names whatever the repo under check', () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);
    const monorepoNames = kit.checklists.map(listDeclaredNames);
    scaffoldRepo(SINGLE_PACKAGE_REPO);
    const singlePackageNames = kit.checklists.map(listDeclaredNames);

    expect(singlePackageNames).toStrictEqual(monorepoNames);
    expect(monorepoNames.flat()).not.toContain('@scope/published');
    expect(singlePackageNames.flat()).not.toContain('single-package');
  });

  it('skips the parent when the repo publishes nothing', () => {
    scaffoldRepo(MONOREPO_PUBLISHING_NOTHING);

    expect(findCheck(PACKAGES_PARENT, packagesChecklist.checks).skip?.()).toBe('no publishable packages');
  });

  it('runs the parent when the repo publishes something', () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);

    expect(findCheck(PACKAGES_PARENT, packagesChecklist.checks).skip?.()).toBe(false);
  });

  it('runs the npm session gate as a check rather than a precondition', async () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);

    expect(packagesChecklist.preconditions?.map((precondition) => precondition.name)).not.toContain(SESSION_GATE);
    expect((await buildPackagesRows())[0]?.name).toBe(SESSION_GATE);
  });

  // The parent's skip covers the gate, so a gate of its own would only repeat it.
  it('declares neither a skip nor any dependent check on the npm session gate', async () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);

    const gate = findCheck(SESSION_GATE, await buildPackagesRows());

    expect(gate.skip).toBeUndefined();
    expect(gate.checks).toBeUndefined();
  });

  // Asserted against the property descriptor because the remediation is the same however the session fails, so
  // nothing here should vary with what the check found.
  it('declares the npm session fix as a value, not an accessor', async () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);

    const descriptor = Object.getOwnPropertyDescriptor(findCheck(SESSION_GATE, await buildPackagesRows()), 'fix');

    expect(descriptor?.value).toBeTypeOf('string');
  });

  // A private member keeps its row. A private root does not: The row reports the workspace as skipped,
  // and the root is not a workspace that a consumer wrote.
  it('builds a check for every discovered member beside the npm session gate', async () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);

    expect((await buildPackagesRows()).map((check) => check.name)).toStrictEqual([
      SESSION_GATE,
      '@scope/private',
      '@scope/published',
    ]);
  });

  it('does not build any check for a private repo root', async () => {
    scaffoldRepo(MONOREPO_WITH_PRIVATE_ROOT);

    // Read the unfiltered list first, so that the root's absence below is the filter's doing rather than the tree's.
    expect(discoverWorkspaces().map((workspace) => workspace.name)).toContain('monorepo');
    expect((await buildPackagesRows()).map((check) => check.name)).not.toContain('monorepo');
  });

  it('builds the full workspace check for a publishable repo root', async () => {
    scaffoldRepo(SINGLE_PACKAGE_REPO);

    const rows = await buildPackagesRows();

    expect(rows.map((check) => check.name)).toStrictEqual([SESSION_GATE, 'single-package']);
    expect(listDeclaredChildren(findCheck('single-package', rows)).map((check) => check.name)).toStrictEqual([
      'repository field exists',
      'published to npm',
      'files field exists',
    ]);
  });
});

// region | Helpers

/** Builds the checks that the packages checklist's parent builds when the checklist runs. */
async function buildPackagesRows(): Promise<readonly RdyCheck[]> {
  const { checks } = findCheck(PACKAGES_PARENT, packagesChecklist.checks);
  assert(typeof checks === 'function', `Expected "${PACKAGES_PARENT}" to build its checks at run time`);
  return checks();
}

/** Finds a check by name among `siblings`. */
function findCheck(name: string, siblings: readonly RdyCheck[]): RdyCheck {
  const check = siblings.find((candidate) => candidate.name === name);
  assert(check, `Expected a "${name}" check`);
  return check;
}

/** Returns the named checklist from the kit, asserting it is flat so that a staged form fails loudly. */
function findChecklist(name: string): RdyChecklist {
  const checklist = kit.checklists.find((candidate) => candidate.name === name);
  assert(checklist && isFlatChecklist(checklist), `Expected the kit to contain a flat "${name}" checklist`);
  return checklist;
}

/** Lists a check's name followed by its declared dependents' names, skipping dependents built at run time. */
function flattenDeclaredNames(check: RdyCheck): string[] {
  const children = typeof check.checks === 'function' ? [] : (check.checks ?? []);
  return [check.name, ...children.flatMap(flattenDeclaredNames)];
}

/** Lists a checklist's declared check names in the order of readyup's compile, without any built at run time. */
function listDeclaredNames(checklist: (typeof kit.checklists)[number]): string[] {
  const checks = isFlatChecklist(checklist) ? checklist.checks : checklist.groups.flat();
  return [...(checklist.preconditions ?? []), ...checks].flatMap(flattenDeclaredNames);
}

// endregion | Helpers
