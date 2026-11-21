import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const workflowsDir = join(import.meta.dirname, '..', '.github', 'workflows');

/** Matches an active `uses:` line, capturing the ref and any trailing comment; commented-out lines never match. */
const USES_LINE_PATTERN = /^\s*(?:-\s+)?uses:\s*(\S+)(?:\s+#\s*(.*?))?\s*$/gm;

/** Matches the `uses:` reference to the label-sync action and its trailing version comment. */
const LABEL_SYNC_USES_PATTERN = /uses:\s*EndBug\/label-sync@(\S+)(?:\s*#\s*(.*?))?\s*$/m;

/** Matches the note recording which release's vendored engine was verified. */
const ENGINE_NOTE_PATTERN = /Engine verified for (v\d+\.\d+\.\d+): vendors (github-label-sync@\d+\.\d+\.\d+)/;

/**
 * Enforces the pinning policy in `.github/workflows/README.md`: every action outside the `williamthorsen` account is
 * pinned by commit SHA, with a trailing comment that Dependabot can rotate.
 */
describe('workflow action pins', () => {
  const refs = collectUsesRefs();
  const externalRefs = refs.filter((entry) => !isExemptRef(entry.ref));

  it('finds external action refs to check', () => {
    expect(externalRefs.length).toBeGreaterThan(0);
  });

  it.each(externalRefs)('$file pins $ref by commit SHA with a release comment', ({ ref, comment }) => {
    expect(findPinViolation(ref, comment)).toBeUndefined();
  });

  it('exempts first-party and local refs', () => {
    expect(isExemptRef('williamthorsen/.github/.github/workflows/code-quality-pnpm-workflow.yaml@v8')).toBe(true);
    expect(isExemptRef('./.github/actions/setup')).toBe(true);
    expect(isExemptRef('actions/checkout@v7')).toBe(false);
  });

  it('accepts a SHA pin whose comment contains the release alone', () => {
    expect(findPinViolation(`actions/checkout@${'a'.repeat(40)}`, 'v7.0.1')).toBeUndefined();
    expect(findPinViolation(`github/codeql-action/init@${'b'.repeat(40)}`, 'v4.1.0')).toBeUndefined();
  });

  it('rejects a tag pin, a short SHA, and a comment that Dependabot would not rotate', () => {
    expect(findPinViolation('actions/checkout@v7', 'v7.0.1')).toMatch(/commit SHA/);
    expect(findPinViolation('actions/checkout@0123abc', 'v7.0.1')).toMatch(/commit SHA/);
    expect(findPinViolation(`actions/checkout@${'a'.repeat(40)}`, undefined)).toMatch(/comment/);
    expect(findPinViolation(`actions/checkout@${'a'.repeat(40)}`, 'v7.0.1 (pinned)')).toMatch(/comment/);
  });
});

/**
 * Guards the provenance recorded against the label-sync pin.
 *
 * The action's floating `v2` tag can move to a bundle with different rename semantics and
 * handling of undeclared labels (its unreleased `main` already swaps the vendored engine for
 * `@endbug/github-label-sync@3`), and this workflow relies on the pinned engine leaving every
 * label not declared by the config file in place.
 *
 * Dependabot rewrites the trailing version comment in step with the SHA, but it never touches
 * the engine note. Asserting that the two name the same release turns a rotation into a failing
 * check on the bump itself, rather than a provenance claim that quietly stops being true.
 */
describe('sync-labels.reusable.yaml pins the label-sync action', () => {
  const content = readFileSync(join(workflowsDir, 'sync-labels.reusable.yaml'), 'utf8');
  const usesMatch = LABEL_SYNC_USES_PATTERN.exec(content);
  const engineMatch = ENGINE_NOTE_PATTERN.exec(content);

  it('references the action', () => {
    expect(usesMatch, 'no `uses: EndBug/label-sync@…` reference found').not.toBeNull();
  });

  it('records the vendored engine against the release that the pin names', () => {
    expect(engineMatch, 'no `Engine verified for vX.Y.Z: vendors github-label-sync@X.Y.Z` note found').not.toBeNull();
    expect(
      engineMatch?.[1],
      'the engine note names a different release than the pin; re-verify the vendored engine against the pinned release lockfile and update the note',
    ).toBe(usesMatch?.[2]);
  });
});

// region | Helpers

/** Returns every active `uses:` ref in the workflow files, with the file that contains it and its trailing comment. */
function collectUsesRefs(): Array<{ comment: string | undefined; file: string; ref: string }> {
  return readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yaml'))
    .toSorted()
    .flatMap((file) =>
      readFileSync(join(workflowsDir, file), 'utf8')
        .matchAll(USES_LINE_PATTERN)
        .map((match) => ({ comment: match[2], file, ref: match[1] ?? '' }))
        .toArray(),
    );
}

/** Returns the reason that an external ref breaks the pinning policy, or `undefined` when it complies. */
function findPinViolation(ref: string, comment: string | undefined): string | undefined {
  const isShaPinned = /^[\w.-]+\/[\w.-]+(?:\/[^@\s]+)?@[0-9a-f]{40}$/.test(ref);
  const isReleaseComment = /^v\d+\.\d+\.\d+$/.test(comment ?? '');
  return !isShaPinned
    ? `pin ${ref} by its full commit SHA; a tag can move to code that was never reviewed`
    : !isReleaseComment
      ? `follow ${ref} with a trailing \`# vX.Y.Z\` comment holding nothing else, which Dependabot rotates with the SHA`
      : undefined;
}

/** Reports whether a ref is exempt from SHA pinning: first-party refs keep their tags, and local refs take none. */
function isExemptRef(ref: string): boolean {
  return ref.startsWith('./') || ref.startsWith('williamthorsen/');
}

// endregion | Helpers
