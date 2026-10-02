import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { runInThisContext } from 'node:vm';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

const workflowPath = join(import.meta.dirname, '..', '.github', 'workflows', 'sync-labels.reusable.yaml');

/** Path from which the engine reads the labels file without the archived mark. */
const ENGINE_CONFIG_PATH = '${{ runner.temp }}/labels.engine.yaml';

interface RepoLabel {
  name: string;
  archived_at: string | null;
}

interface DeclaredLabel {
  name: string;
  color: string;
  description: string;
  archived?: true;
}

/** Signature of a script that `actions/github-script` runs, limited to the parameters that this one reads. */
type GithubScript = (
  github: ReturnType<typeof createGithubMock>,
  context: { repo: { owner: string; repo: string } },
  core: ReturnType<typeof createCoreMock>,
  require: NodeJS.Require,
) => Promise<void>;

const steps = readSteps();

describe('sync-labels.reusable.yaml hands the engine a labels file without the archived mark', () => {
  it('points the engine at the stripped copy', () => {
    const engineStep = steps.find((step) => step.uses?.startsWith('EndBug/label-sync@'));
    expect(engineStep?.with?.['config-file']).toBe(ENGINE_CONFIG_PATH);
  });

  it('writes the stripped copy before the engine runs', () => {
    const prepareIndex = steps.findIndex((step) => step.run?.includes('$RUNNER_TEMP/labels.engine.yaml'));
    const engineIndex = steps.findIndex((step) => step.uses?.startsWith('EndBug/label-sync@'));
    expect(steps[prepareIndex]?.run).toContain("yq 'map(del(.archived))' .github/labels.yaml");
    expect(prepareIndex).toBeGreaterThanOrEqual(0);
    expect(prepareIndex).toBeLessThan(engineIndex);
  });
});

describe('sync-labels.reusable.yaml reconciles archive state', () => {
  let tree: TempTree;
  let github: ReturnType<typeof createGithubMock>;
  let core: ReturnType<typeof createCoreMock>;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'sync-labels-' }));
    github = createGithubMock();
    core = createCoreMock();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('archives a marked label that is active', async () => {
    github.paginate.mockResolvedValue([{ name: 'scope:basic', archived_at: null }]);

    await runReconcile({ declared: [declare('scope:basic', true)] });

    expect(github.request).toHaveBeenCalledWith('PATCH /repos/{owner}/{repo}/labels/{name}', {
      owner: 'acme',
      repo: 'widgets',
      name: 'scope:basic',
      archived: true,
    });
    expect(core.info).toHaveBeenCalledWith('Archived scope:basic');
  });

  it('unarchives an archived label that is declared without the mark', async () => {
    github.paginate.mockResolvedValue([{ name: 'scope:basic', archived_at: '2026-10-02T00:30:01Z' }]);

    await runReconcile({ declared: [declare('scope:basic')] });

    expect(github.request).toHaveBeenCalledWith(
      'PATCH /repos/{owner}/{repo}/labels/{name}',
      expect.objectContaining({ name: 'scope:basic', archived: false }),
    );
    expect(core.info).toHaveBeenCalledWith('Unarchived scope:basic');
  });

  it('leaves a marked label alone once it is archived', async () => {
    github.paginate.mockResolvedValue([{ name: 'scope:basic', archived_at: '2026-10-02T00:30:01Z' }]);

    await runReconcile({ declared: [declare('scope:basic', true)] });

    expect(github.request).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('matches a declared label to the repository label of a different case, patching it by its current name', async () => {
    github.paginate.mockResolvedValue([{ name: 'Scope:Basic', archived_at: null }]);

    await runReconcile({ declared: [declare('scope:basic', true)] });

    expect(github.request).toHaveBeenCalledWith(
      'PATCH /repos/{owner}/{repo}/labels/{name}',
      expect.objectContaining({ name: 'Scope:Basic', archived: true }),
    );
  });

  it('logs each pending archive and unarchive in a dry run without patching', async () => {
    github.paginate.mockResolvedValue([
      { name: 'scope:old', archived_at: null },
      { name: 'scope:revived', archived_at: '2026-10-02T00:30:01Z' },
    ]);

    await runReconcile({
      declared: [declare('scope:new', true), declare('scope:old', true), declare('scope:revived')],
      isDryRun: true,
    });

    expect(github.request).not.toHaveBeenCalled();
    expect(core.info.mock.calls.map(([message]) => message)).toStrictEqual([
      'Would archive scope:new after creating it',
      'Would archive scope:old',
      'Would unarchive scope:revived',
    ]);
    expect(core.startGroup).toHaveBeenCalledWith('Archive state');
  });

  it('fails when a marked label is missing from the repository after the engine has run', async () => {
    github.paginate.mockResolvedValue([]);

    await runReconcile({ declared: [declare('scope:basic', true)] });

    expect(core.setFailed).toHaveBeenCalledWith(
      'scope:basic is marked as archived, but the repository does not have it',
    );
  });

  it('fails when the archive request fails', async () => {
    github.paginate.mockResolvedValue([{ name: 'scope:basic', archived_at: null }]);
    github.request.mockRejectedValue(new Error('Resource not accessible by integration'));

    await runReconcile({ declared: [declare('scope:basic', true)] });

    expect(core.setFailed).toHaveBeenCalledWith(
      'Failed to archive scope:basic: Resource not accessible by integration',
    );
  });

  it('reports that nothing changed when every label is already in its declared state', async () => {
    github.paginate.mockResolvedValue([{ name: 'bug', archived_at: null }]);

    await runReconcile({ declared: [declare('bug')] });

    expect(core.info).toHaveBeenCalledWith('Every declared label is already in its declared archive state.');
  });

  /** Writes the declared labels where the step reads them and runs the step's script against the mocks. */
  async function runReconcile({ declared, isDryRun = false }: { declared: DeclaredLabel[]; isDryRun?: boolean }) {
    vi.stubEnv('LABELS_FILE', tree.writeJson('labels.json', declared));
    vi.stubEnv('DRY_RUN', String(isDryRun));

    await loadReconcileScript()(
      github,
      { repo: { owner: 'acme', repo: 'widgets' } },
      core,
      createRequire(import.meta.url),
    );
  }
});

// region | Helpers

/** Creates a `core` mock exposing the members that the script calls. */
function createCoreMock() {
  return { endGroup: vi.fn(), info: vi.fn<(message: string) => void>(), setFailed: vi.fn(), startGroup: vi.fn() };
}

/** Creates a `github` client mock exposing the members that the script calls. */
function createGithubMock() {
  return { paginate: vi.fn<() => Promise<RepoLabel[]>>(), request: vi.fn() };
}

/** Builds a declared label entry as `sync-labels generate` writes it. */
function declare(name: string, isArchived = false): DeclaredLabel {
  return { name, color: '00ff96', description: '', ...(isArchived && { archived: true }) };
}

/** Compiles the reconcile step's script into a function taking the parameters that `actions/github-script` passes. */
function loadReconcileScript(): GithubScript {
  const script = steps.find((step) => step.uses?.startsWith('actions/github-script@'))?.with?.['script'];
  if (script === undefined) {
    throw new Error('sync-labels.reusable.yaml has no actions/github-script step with a script');
  }
  // The compiled source is the step's script wrapped as `actions/github-script` wraps it; its type is not inferable.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- `runInThisContext` returns `any`.
  return runInThisContext(`(async (github, context, core, require) => {\n${script}\n})`);
}

/** Reads the steps of the workflow's single job. */
function readSteps(): Array<{ run?: string; uses?: string; with?: Record<string, string> }> {
  const workflow: unknown = parse(readFileSync(workflowPath, 'utf8'));
  if (!isWorkflow(workflow)) {
    throw new Error('sync-labels.reusable.yaml does not define a `sync` job with steps');
  }
  return workflow.jobs.sync.steps;
}

/** Narrows a parsed workflow to the shape that `readSteps` reads. */
function isWorkflow(value: unknown): value is {
  jobs: { sync: { steps: Array<{ run?: string; uses?: string; with?: Record<string, string> }> } };
} {
  if (typeof value !== 'object' || value === null || !('jobs' in value)) return false;
  const { jobs } = value;
  if (typeof jobs !== 'object' || jobs === null || !('sync' in jobs)) return false;
  const { sync } = jobs;
  return typeof sync === 'object' && sync !== null && 'steps' in sync && Array.isArray(sync.steps);
}

// endregion | Helpers
