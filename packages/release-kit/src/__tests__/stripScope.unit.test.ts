import { describe, expect, it } from 'vitest';

import { stripScope } from '../stripScope.ts';

describe(stripScope, () => {
  it.each([
    ['release-kit|fix: Foo', 'fix: Foo'],
    ['#72 release-kit|fix: Foo (#80)', '#72 fix: Foo (#80)'],
    ['fix(release-kit): Foo', 'fix: Foo'],
    ['#72 fix(release-kit): Foo', '#72 fix: Foo'],
    ['feat: No scope here', 'feat: No scope here'],
    ['unparseable message', 'unparseable message'],
    ['release-kit|feat!: Breaking change', 'feat!: Breaking change'],
    ['feat(parser)!: Breaking scoped', 'feat!: Breaking scoped'],
    ['TOOL-123 web|fix: Jira prefix', 'TOOL-123 fix: Jira prefix'],
  ])('stripScope(%j) -> %j', (input, expected) => {
    expect(stripScope(input)).toBe(expected);
  });
});
