import { vi } from 'vitest';

import type { Git } from '../git.ts';

/** A `Git` whose every method is a spy. */
export type FakeGit = { [Method in keyof Git]: ReturnType<typeof vi.fn<Git[Method]>> };

/**
 * Builds a `Git` that answers as a clean repository whose HEAD is on `main` without any tags or commits, with each
 * method in `overrides` taking the place of the default.
 */
export function makeFakeGit(overrides: Partial<Git> = {}): FakeGit {
  return {
    addAll: vi.fn(overrides.addAll ?? (() => {})),
    commit: vi.fn(overrides.commit ?? (() => {})),
    createAnnotatedTag: vi.fn(overrides.createAnnotatedTag ?? (() => {})),
    hasTrackedChanges: vi.fn(overrides.hasTrackedChanges ?? (() => false)),
    isInsideWorkTree: vi.fn(overrides.isInsideWorkTree ?? (() => true)),
    listTags: vi.fn(overrides.listTags ?? (() => [])),
    listTagsAtHead: vi.fn(overrides.listTagsAtHead ?? (() => [])),
    listTagRefs: vi.fn(overrides.listTagRefs ?? (() => [])),
    pushBranch: vi.fn(overrides.pushBranch ?? (() => {})),
    pushTag: vi.fn(overrides.pushTag ?? (() => {})),
    readAncestry: vi.fn(overrides.readAncestry ?? (() => [])),
    readCommits: vi.fn(overrides.readCommits ?? (() => [])),
    readCurrentBranch: vi.fn(overrides.readCurrentBranch ?? (() => 'main')),
    readStatus: vi.fn(overrides.readStatus ?? (() => '')),
  };
}
