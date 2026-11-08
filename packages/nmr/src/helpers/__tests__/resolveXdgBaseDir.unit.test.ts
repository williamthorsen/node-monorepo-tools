import { describe, expect, it } from 'vitest';

import { resolveXdgBaseDir } from '../resolveXdgBaseDir.ts';

describe(resolveXdgBaseDir, () => {
  it('returns the variable when it is an absolute path', () => {
    const env = { HOME: '/home/dev', XDG_CACHE_HOME: '/var/cache/dev' };

    expect(resolveXdgBaseDir(env, 'XDG_CACHE_HOME', '.cache')).toBe('/var/cache/dev');
  });

  it('falls back to the subdirectory of HOME when the variable is relative', () => {
    const env = { HOME: '/home/dev', XDG_CACHE_HOME: 'relative/cache' };

    expect(resolveXdgBaseDir(env, 'XDG_CACHE_HOME', '.cache')).toBe('/home/dev/.cache');
  });

  it('falls back to the subdirectory of HOME when the variable is unset', () => {
    expect(resolveXdgBaseDir({ HOME: '/home/dev' }, 'XDG_CONFIG_HOME', '.config')).toBe('/home/dev/.config');
  });

  it('returns undefined when neither the variable nor an absolute HOME is set', () => {
    expect(resolveXdgBaseDir({ HOME: 'relative' }, 'XDG_CACHE_HOME', '.cache')).toBeUndefined();
  });
});
