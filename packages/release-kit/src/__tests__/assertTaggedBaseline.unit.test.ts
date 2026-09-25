import { join } from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { assertTaggedBaseline, type BaselineTarget, findUntaggedBaseline } from '../assertTaggedBaseline.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';

const config = { changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } };

describe(findUntaggedBaseline, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'assert-tagged-baseline-' }));
    tree.writeJson('package.json', { version: '1.3.0' });
  });

  it('finds a current version recorded in CHANGELOG.md whose tag is not the previous tag', () => {
    tree.write('CHANGELOG.md', '## 1.3.0\n\n- Released\n\n## 1.2.0\n');

    expect(findUntaggedBaseline(makeTarget({ previousTag: 'api-v1.2.0' }), config)).toStrictEqual({
      label: "workspace 'api'",
      version: '1.3.0',
      tag: 'api-v1.3.0',
    });
  });

  it('finds a current version recorded only in changelog.json', () => {
    tree.writeJson('.meta/changelog.json', [{ version: '1.3.0', date: '2024-01-01', sections: [] }]);

    expect(findUntaggedBaseline(makeTarget({ previousTag: undefined }), config)).toMatchObject({ tag: 'api-v1.3.0' });
  });

  it('finds nothing on a first release, whose version no changelog records', () => {
    tree.write('CHANGELOG.md', '## 1.2.0\n');

    expect(findUntaggedBaseline(makeTarget({ previousTag: undefined }), config)).toBeUndefined();
  });

  it('finds nothing when the previous tag is the current version', () => {
    tree.write('CHANGELOG.md', '## 1.3.0\n');

    expect(findUntaggedBaseline(makeTarget({ previousTag: 'api-v1.3.0' }), config)).toBeUndefined();
  });

  it('finds nothing when the previous tag is the current version under a legacy prefix', () => {
    tree.write('CHANGELOG.md', '## 1.3.0\n');

    expect(findUntaggedBaseline(makeTarget({ previousTag: 'old-api-v1.3.0' }), config)).toBeUndefined();
  });

  it('does not read the package files when no changelog exists', () => {
    const target = { ...makeTarget({ previousTag: undefined }), packageFiles: [join(tree.dir, 'missing.json')] };

    expect(findUntaggedBaseline(target, config)).toBeUndefined();
  });

  /** Builds a target rooted at the temporary tree, tagged under `api-v` with the legacy prefix `old-api-v`. */
  function makeTarget(overrides: Pick<BaselineTarget, 'previousTag'>): BaselineTarget {
    return {
      label: "workspace 'api'",
      packageFiles: [join(tree.dir, 'package.json')],
      changelogPaths: [tree.dir],
      tagPrefixes: ['api-v', 'old-api-v'],
      ...overrides,
    };
  }
});

describe(assertTaggedBaseline, () => {
  it('does not throw when no finding is an untagged baseline', () => {
    expect(() => assertTaggedBaseline([undefined])).not.toThrow();
  });

  it('names every target, version, and tag to create in one error', () => {
    expect(() =>
      assertTaggedBaseline([
        { label: "workspace 'api'", version: '1.3.0', tag: 'api-v1.3.0' },
        undefined,
        { label: 'project', version: '2.0.0', tag: 'v2.0.0' },
      ]),
    ).toThrow(
      [
        'The current version is recorded in the changelog, but its tag is not the previous tag reachable from HEAD:',
        "  - workspace 'api': 1.3.0 (create tag api-v1.3.0)",
        '  - project: 2.0.0 (create tag v2.0.0)',
        'Tag the commit that released each version, then run prepare again.',
      ].join('\n'),
    );
  });
});
