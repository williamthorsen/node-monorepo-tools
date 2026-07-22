import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const workflowsDir = join(import.meta.dirname, '..', '.github', 'workflows');

/** Matches the `uses:` reference to the label-sync action and its trailing provenance comment. */
const LABEL_SYNC_USES_PATTERN = /uses:\s*EndBug\/label-sync@(\S+)(?:\s*#\s*(.*))?$/m;

/**
 * Guards the commit-SHA pin on `EndBug/label-sync`.
 *
 * The action's floating `v2` tag can move to a bundle with different delete and rename
 * semantics — its unreleased `main` already swaps the vendored engine for
 * `@endbug/github-label-sync@3` — and this workflow deletes every label the config file
 * does not declare. A pin regressed to a tag would silently widen that blast radius,
 * so the SHA and the provenance comment beside it are asserted rather than trusted.
 */
describe('sync-labels.reusable.yaml pins the label-sync action', () => {
  const content = readFileSync(join(workflowsDir, 'sync-labels.reusable.yaml'), 'utf8');
  const match = LABEL_SYNC_USES_PATTERN.exec(content);

  it('references the action', () => {
    expect(match, 'no `uses: EndBug/label-sync@…` reference found').not.toBeNull();
  });

  it('references it by 40-hex commit SHA, not a movable tag', () => {
    expect(match?.[1], 'pin the action by commit SHA; a tag can move to a different engine bundle').toMatch(
      /^[0-9a-f]{40}$/,
    );
  });

  it('records the release and vendored engine version beside the pin', () => {
    const comment = match?.[2] ?? '';

    expect(comment, 'name the action release beside the SHA, e.g. `# v2.3.3`').toMatch(/v\d+\.\d+\.\d+/);
    expect(comment, 'name the vendored engine version beside the SHA, e.g. `vendors github-label-sync@2.3.1`').toMatch(
      /github-label-sync@\d+\.\d+\.\d+/,
    );
  });
});
