import { describe, expect, it } from 'vitest';

import { hasProvenance } from '../hasProvenance.ts';

describe(hasProvenance, () => {
  it.each([
    ['an unquoted true', '      provenance: true\n'],
    ['a quoted true', "      provenance: 'true'\n"],
  ])('detects %s', (_label, content) => {
    expect(hasProvenance(content)).toBe(true);
  });

  it.each([
    ['a missing setting', '      tags: v1\n'],
    ['a false setting', '      provenance: false\n'],
    ['a commented-out setting', '      # provenance: true\n'],
  ])('rejects %s', (_label, content) => {
    expect(hasProvenance(content)).toBe(false);
  });
});
