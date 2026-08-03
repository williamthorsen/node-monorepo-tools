import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const workflowsDir = join(import.meta.dirname, '..', '.github', 'workflows');

/** Matches the `uses:` reference to the label-sync action and its trailing version comment. */
const LABEL_SYNC_USES_PATTERN = /uses:\s*EndBug\/label-sync@(\S+)(?:\s*#\s*(.*?))?\s*$/m;

/** Matches the note recording which release's vendored engine was verified. */
const ENGINE_NOTE_PATTERN = /Engine verified for (v\d+\.\d+\.\d+): vendors (github-label-sync@\d+\.\d+\.\d+)/;

/**
 * Guards the commit-SHA pin on `EndBug/label-sync` and the provenance recorded against it.
 *
 * The action's floating `v2` tag can move to a bundle with different delete and rename
 * semantics — its unreleased `main` already swaps the vendored engine for
 * `@endbug/github-label-sync@3` — and this workflow deletes every label the config file
 * does not declare.
 *
 * Dependabot rewrites the trailing version comment in step with the SHA, but only while
 * that comment holds the version alone, and it never touches the engine note. Asserting
 * that the two name the same release turns a rotation into a failing check on the bump
 * itself, rather than a provenance claim that quietly stops being true.
 */
describe('sync-labels.reusable.yaml pins the label-sync action', () => {
  const content = readFileSync(join(workflowsDir, 'sync-labels.reusable.yaml'), 'utf8');
  const usesMatch = LABEL_SYNC_USES_PATTERN.exec(content);
  const engineMatch = ENGINE_NOTE_PATTERN.exec(content);

  it('references the action', () => {
    expect(usesMatch, 'no `uses: EndBug/label-sync@…` reference found').not.toBeNull();
  });

  it('references it by 40-hex commit SHA, not a movable tag', () => {
    expect(usesMatch?.[1], 'pin the action by commit SHA; a tag can move to a different engine bundle').toMatch(
      /^[0-9a-f]{40}$/,
    );
  });

  it('names the release in a trailing comment holding nothing else', () => {
    expect(
      usesMatch?.[2],
      'keep the trailing comment to `# vX.Y.Z`; dependabot skips comments carrying any other text, stranding the version on the old release',
    ).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('records the vendored engine against the release the pin names', () => {
    expect(engineMatch, 'no `Engine verified for vX.Y.Z: vendors github-label-sync@X.Y.Z` note found').not.toBeNull();
    expect(
      engineMatch?.[1],
      'the engine note names a different release than the pin; re-verify the vendored engine against the pinned release lockfile and update the note',
    ).toBe(usesMatch?.[2]);
  });
});
