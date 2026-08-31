import { describe, expect, it } from 'vitest';

import type { OutputConfig } from '../types.ts';
import {
  AGENT_ENV_VARS,
  COMMAND_VERBOSITY_ENV_VAR,
  type CommandVerbosity,
  readVerbosityEnv,
  resolveVerbosity,
  type VerbosityRead,
} from '../verbosity.ts';

describe(readVerbosityEnv, () => {
  it.each([
    { raw: undefined, scenario: 'no value at all' },
    { raw: '', scenario: 'a value left empty' },
  ])('given $scenario, names no verbosity, leaving the levels below reachable', ({ raw }) => {
    const env = raw === undefined ? {} : { [COMMAND_VERBOSITY_ENV_VAR]: raw };

    expect(readVerbosityEnv(env)).toStrictEqual({ ok: true });
  });

  it.each([{ raw: 'full' }, { raw: 'quiet' }])('reads a $raw the environment names', ({ raw }) => {
    expect(readVerbosityEnv({ [COMMAND_VERBOSITY_ENV_VAR]: raw })).toStrictEqual({ ok: true, verbosity: raw });
  });

  it.each([
    { raw: 'silent', scenario: 'a point that is not on the ladder' },
    { raw: 'QUIET', scenario: 'a recognized value in the wrong case' },
    { raw: ' quiet', scenario: 'a recognized value carrying whitespace' },
  ])('given $scenario, resolves to nothing rather than a mode nobody chose', ({ raw }) => {
    expect(readVerbosityEnv({ [COMMAND_VERBOSITY_ENV_VAR]: raw }).ok).toBe(false);
  });

  it('names the variable and both accepted values when it rejects', () => {
    const error = errorFrom(readVerbosityEnv({ [COMMAND_VERBOSITY_ENV_VAR]: 'silent' }));

    expect(error).toContain(COMMAND_VERBOSITY_ENV_VAR);
    expect(error).toContain('full');
    expect(error).toContain('quiet');
  });
});

describe(resolveVerbosity, () => {
  describe('each level deciding on its own', () => {
    it('given nothing at all, resolves to full', () => {
      expect(resolve({})).toBe('full');
    });

    it('given the flag alone, resolves to quiet', () => {
      expect(resolve({ quietFlag: true })).toBe('quiet');
    });

    it('given an environment value alone, resolves to it', () => {
      expect(resolve({ envVerbosity: 'quiet' })).toBe('quiet');
    });

    it('given a config default alone, resolves to it', () => {
      expect(resolve({ output: { commandVerbosity: 'quiet' } })).toBe('quiet');
    });

    it.each(AGENT_ENV_VARS)('given the %s marker alone, resolves to quiet', (name) => {
      expect(resolve({ env: { [name]: '1' } })).toBe('quiet');
    });

    it('given a marker a repo added, resolves to quiet', () => {
      expect(resolve({ env: { MY_CLI: '1' }, output: { extraAgentEnvVars: ['MY_CLI'] } })).toBe('quiet');
    });
  });

  describe('each level outranking the one below it', () => {
    it('given the flag against a full environment, resolves to quiet', () => {
      expect(resolve({ envVerbosity: 'full', quietFlag: true })).toBe('quiet');
    });

    it('given a full environment against a quiet config, resolves to full', () => {
      expect(resolve({ envVerbosity: 'full', output: { commandVerbosity: 'quiet' } })).toBe('full');
    });

    // A repo declines detection by naming the mode it wants; a switch of its own would say the same thing twice.
    it('given a full config against a detected harness, resolves to full', () => {
      expect(resolve({ env: { CLAUDECODE: '1' }, output: { commandVerbosity: 'full' } })).toBe('full');
    });
  });

  describe('detection', () => {
    it('leaves an unrecognized harness loud', () => {
      expect(resolve({ env: { SOME_OTHER_CLI: '1' } })).toBe('full');
    });

    it('reads an empty marker as unset, matching how the variable nmr owns reads one', () => {
      expect(resolve({ env: { CLAUDECODE: '' } })).toBe('full');
    });

    // The value convention belongs to the harness, so nmr reads presence and does not interpret what it finds.
    it('fires on a marker holding any non-empty value', () => {
      expect(resolve({ env: { CLAUDECODE: '0' } })).toBe('quiet');
    });

    it('keeps the shipped list when a repo adds to it', () => {
      expect(resolve({ env: { CLAUDECODE: '1' }, output: { extraAgentEnvVars: ['MY_CLI'] } })).toBe('quiet');
    });
  });
});

// region | Helpers

/** Returns the rejection message, failing the test when the value was accepted. */
function errorFrom(read: VerbosityRead): string {
  if (read.ok) throw new Error('Expected an unrecognized value to be rejected');
  return read.error;
}

/** Resolves against an empty ladder, so each case declares only the levels it is about. */
function resolve(options: {
  env?: NodeJS.ProcessEnv;
  envVerbosity?: CommandVerbosity;
  output?: OutputConfig;
  quietFlag?: boolean;
}): CommandVerbosity {
  return resolveVerbosity({
    env: options.env ?? {},
    envVerbosity: options.envVerbosity,
    output: options.output,
    quietFlag: options.quietFlag ?? false,
  });
}

// endregion | Helpers
