import { runInThisContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listSteps, readJob, readReusableWorkflow } from '../test-utils/workflows.ts';

const RUN_URL = 'https://github.com/acme/widgets/actions/runs/42/attempts/1';
const SHA = '0123456789abcdef0123456789abcdef01234567';

interface Issue {
  number: number;
  title: string;
  pull_request?: unknown;
}

/** Signature of a script that `actions/github-script` runs, limited to the parameters that this one reads. */
type GithubScript = (
  github: ReturnType<typeof createGithubMock>,
  context: { repo: { owner: string; repo: string } },
  core: ReturnType<typeof createCoreMock>,
) => Promise<void>;

const workflow = readReusableWorkflow('publish');
const notifyJob = readJob(workflow, 'notify-failure');

describe('publish.reusable.yaml wires the failure notification', () => {
  it('runs only after the publish job fails', () => {
    expect(notifyJob['needs']).toBe('publish');
    expect(notifyJob['if']).toBe('${{ failure() }}');
  });

  it('grants `issues: write` to the notification job alone', () => {
    expect(notifyJob['permissions']).toStrictEqual({ issues: 'write' });
    expect(readJob(workflow, 'publish')['permissions']).toBeUndefined();
    expect(workflow['permissions']).toStrictEqual({ 'id-token': 'write', contents: 'read' });
  });
});

describe('publish.reusable.yaml reports a failed publish as an issue', () => {
  let github: ReturnType<typeof createGithubMock>;
  let core: ReturnType<typeof createCoreMock>;

  beforeEach(() => {
    github = createGithubMock();
    core = createCoreMock();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('opens a labelled issue naming the tags when none is open', async () => {
    await runNotify({ tags: 'nmr-v2.4.0, ,release-kit-v18.5.0' });

    expect(github.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'acme',
        repo: 'widgets',
        title: 'Publish failed: nmr-v2.4.0, release-kit-v18.5.0',
        labels: ['publish-failure'],
        body: expect.stringContaining(`Run: ${RUN_URL}`),
      }),
    );
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('comments on the open issue with the same title rather than opening another', async () => {
    github.paginate.mockResolvedValue([
      { number: 7, title: 'Publish failed: nmr-v2.4.0', pull_request: {} },
      { number: 8, title: 'Publish failed: nmr-v2.4.0' },
    ]);

    await runNotify({ tags: 'nmr-v2.4.0' });

    expect(github.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'widgets',
      issue_number: 8,
      body: `Publish failed again: ${RUN_URL}`,
    });
    expect(github.rest.issues.create).not.toHaveBeenCalled();
  });

  it('searches only open issues that carry the label', async () => {
    await runNotify({ tags: 'nmr-v2.4.0' });

    expect(github.paginate).toHaveBeenCalledWith(
      github.rest.issues.listForRepo,
      expect.objectContaining({ state: 'open', labels: 'publish-failure' }),
    );
  });

  it('names the commit when no tags are given', async () => {
    await runNotify({ tags: '' });

    expect(github.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Publish failed: release tags on 0123456' }),
    );
  });

  it('creates the label when the repository does not have it', async () => {
    github.rest.issues.getLabel.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));

    await runNotify({ tags: 'nmr-v2.4.0' });

    expect(github.rest.issues.createLabel).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'widgets',
      name: 'publish-failure',
      color: 'b60205',
      description: "A release's publish run failed",
    });
  });

  it('leaves an existing label as it is', async () => {
    await runNotify({ tags: 'nmr-v2.4.0' });

    expect(github.rest.issues.createLabel).not.toHaveBeenCalled();
  });

  it('accepts a label created concurrently by another run', async () => {
    github.rest.issues.getLabel.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    github.rest.issues.createLabel.mockRejectedValue(Object.assign(new Error('Validation Failed'), { status: 422 }));

    await runNotify({ tags: 'nmr-v2.4.0' });

    expect(github.rest.issues.create).toHaveBeenCalled();
  });

  it('fails when the issues API rejects the request', async () => {
    github.rest.issues.getLabel.mockRejectedValue(Object.assign(new Error('Issues are disabled'), { status: 410 }));

    await expect(runNotify({ tags: 'nmr-v2.4.0' })).rejects.toThrow('Issues are disabled');
  });

  /** Sets the step's environment and runs its script against the mocks. */
  async function runNotify({ tags }: { tags: string }) {
    vi.stubEnv('RUN_URL', RUN_URL);
    vi.stubEnv('SHA', SHA);
    vi.stubEnv('TAGS', tags);

    await loadScript()(github, { repo: { owner: 'acme', repo: 'widgets' } }, core);
  }
});

// region | Helpers

/** Creates a `core` mock exposing the members that the script calls. */
function createCoreMock() {
  return { info: vi.fn<(message: string) => void>() };
}

/** Creates a `github` client mock exposing the members that the script calls, with an existing label by default. */
function createGithubMock() {
  return {
    paginate: vi.fn<(method: unknown, parameters: unknown) => Promise<Issue[]>>().mockResolvedValue([]),
    rest: {
      issues: {
        create: vi.fn().mockResolvedValue({ data: { number: 9 } }),
        createComment: vi.fn().mockResolvedValue({}),
        createLabel: vi.fn().mockResolvedValue({}),
        getLabel: vi.fn().mockResolvedValue({}),
        listForRepo: vi.fn(),
      },
    },
  };
}

/** Compiles the notification step's script into a function taking the parameters of `actions/github-script`. */
function loadScript(): GithubScript {
  const script = listSteps(notifyJob)[0]?.with?.['script'];
  if (typeof script !== 'string') {
    throw new TypeError('The notify-failure job has no github-script step');
  }
  // The compiled source is the step's script wrapped as `actions/github-script` wraps it; its type is not inferable.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- `runInThisContext` returns `any`.
  return runInThisContext(`(async (github, context, core) => {\n${script}\n})`);
}

// endregion | Helpers
