import { describe, expect, it } from 'vitest';

import { isHookName } from '../../src/helpers/hook-name.js';

describe(isHookName, () => {
  it.each(['build:pre', 'build:post', 'test:pre', 'test:post', 'some:nested:post', 'x:pre', 'x:post'])(
    'returns true for hook name %s',
    (key) => {
      expect(isHookName(key)).toBe(true);
    },
  );

  it.each(['build', 'test', 'lint:check', 'root:test', 'prepare', 'postinstall', ':pre', ':post', ''])(
    'returns false for non-hook name %s',
    (key) => {
      expect(isHookName(key)).toBe(false);
    },
  );
});
