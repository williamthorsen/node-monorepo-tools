import { describe, expect, it } from 'vitest';

import type { VerbosityResolution } from '../verbosity.ts';
import { COMMAND_VERBOSITY_ENV_VAR, resolveVerbosity } from '../verbosity.ts';

describe(resolveVerbosity, () => {
  it.each([
    { inherited: undefined, scenario: 'no inherited value', verbosity: 'full' },
    { inherited: '', scenario: 'an inherited value left empty', verbosity: 'full' },
    { inherited: 'full', scenario: 'an inherited `full`', verbosity: 'full' },
    { inherited: 'quiet', scenario: 'an inherited `quiet`', verbosity: 'quiet' },
  ])('given $scenario and no flag, resolves to $verbosity', ({ inherited, verbosity }) => {
    const env = inherited === undefined ? {} : { [COMMAND_VERBOSITY_ENV_VAR]: inherited };

    expect(resolveVerbosity(env, false)).toStrictEqual({ ok: true, verbosity });
  });

  it.each([
    { inherited: undefined, scenario: 'nothing to outrank' },
    { inherited: 'full', scenario: 'an inherited `full` to outrank' },
    { inherited: 'quiet', scenario: 'an inherited `quiet` to agree with' },
  ])('given the flag and $scenario, resolves to quiet', ({ inherited }) => {
    const env = inherited === undefined ? {} : { [COMMAND_VERBOSITY_ENV_VAR]: inherited };

    expect(resolveVerbosity(env, true)).toStrictEqual({ ok: true, verbosity: 'quiet' });
  });

  it.each([
    { inherited: 'silent', scenario: 'a point that is not on the ladder' },
    { inherited: 'QUIET', scenario: 'a recognized value in the wrong case' },
    { inherited: ' quiet', scenario: 'a recognized value carrying whitespace' },
  ])('given $scenario, resolves to nothing rather than a mode nobody chose', ({ inherited }) => {
    const result = resolveVerbosity({ [COMMAND_VERBOSITY_ENV_VAR]: inherited }, false);

    expect(result.ok).toBe(false);
  });

  it('names the variable and both accepted values when it rejects', () => {
    const error = errorFrom(resolveVerbosity({ [COMMAND_VERBOSITY_ENV_VAR]: 'silent' }, false));

    expect(error).toContain(COMMAND_VERBOSITY_ENV_VAR);
    expect(error).toContain('full');
    expect(error).toContain('quiet');
  });

  // The flag cannot rescue a value the environment got wrong: a run that silently ignored it would leave the
  // misspelling in place for every later invocation in that shell.
  it('rejects an unrecognized inherited value even under the flag', () => {
    expect(resolveVerbosity({ [COMMAND_VERBOSITY_ENV_VAR]: 'silent' }, true).ok).toBe(false);
  });
});

// region | Helpers

/** Returns the rejection message, failing the test when the value was accepted. */
function errorFrom(resolution: VerbosityResolution): string {
  if (resolution.ok) throw new Error('Expected an unrecognized value to be rejected');
  return resolution.error;
}

// endregion | Helpers
