import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CACHEABLE_COMMANDS,
  formatMisplacedNoCacheWarning,
  resolveCacheableCommands,
  resolveRunId,
  RUN_ID_ENV_VAR,
  writeDebugNote,
} from '../check-cache.ts';

describe('check-cache', () => {
  describe(resolveCacheableCommands, () => {
    it('caches the pure checks and the gate that composes them', () => {
      const commands = resolveCacheableCommands(undefined);

      expect([...commands].toSorted()).toStrictEqual(DEFAULT_CACHEABLE_COMMANDS.toSorted());
      expect(commands).toContain('ci');
      expect(commands).toContain('check:strict');
      expect(commands).toContain('root:typecheck');
    });

    it('leaves out the commands whose result does not follow from the tree', () => {
      // `audit` consults a vulnerability database that changes on its own; the mutating and build commands
      // either change the tree that they were asked about or keep a cache of their own.
      const commands = resolveCacheableCommands(undefined);

      for (const command of ['audit', 'build', 'compile', 'fix', 'fmt', 'lint', 'prepush', 'test:all', 'upgrade']) {
        expect(commands).not.toContain(command);
      }
    });

    it('extends the defaults rather than replacing them', () => {
      const commands = resolveCacheableCommands({ extraCommands: ['verify'] });

      expect(commands).toContain('verify');
      expect(commands).toContain('ci');
    });

    it('drops an excluded default', () => {
      expect(resolveCacheableCommands({ excludeCommands: ['test:coverage'] })).not.toContain('test:coverage');
    });

    it('applies exclusions after additions, so a name in both is excluded', () => {
      const commands = resolveCacheableCommands({ extraCommands: ['verify'], excludeCommands: ['verify'] });

      expect(commands).not.toContain('verify');
    });
  });

  describe(resolveRunId, () => {
    it('keeps the identity that an ancestor passed down, so one run has one identity at every scope', () => {
      expect(resolveRunId({ [RUN_ID_ENV_VAR]: 'the-run' })).toBe('the-run');
    });

    it('starts a run when the environment does not contain one', () => {
      expect(resolveRunId({})).not.toBe(resolveRunId({}));
    });

    it('starts a run when the inherited value is empty', () => {
      expect(resolveRunId({ [RUN_ID_ENV_VAR]: '' })).not.toBe('');
    });
  });

  describe('what the gate says out loud', () => {
    it('names the flag’s intended position when it appears after the command', () => {
      expect(formatMisplacedNoCacheWarning('ci', 'rich')).toContain('nmr --no-cache ci');
    });

    it.each([
      { expectedMarker: '🟠 ', style: 'rich' },
      { expectedMarker: 'WARN ', style: 'plain' },
    ] as const)('opens the warning on the $style marker', ({ expectedMarker, style }) => {
      expect(formatMisplacedNoCacheWarning('ci', style).startsWith(expectedMarker)).toBe(true);
    });

    it('says nothing about a gate decision unless asked', () => {
      // A reason to run is not news; a line per invocation would hide the output of whatever did run.
      const stderr = new PassThrough();
      const chunks: Buffer[] = [];
      stderr.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      writeDebugNote('tree changed', {}, stderr);

      expect(Buffer.concat(chunks).toString('utf8')).toBe('');
    });

    it('explains a gate decision when NMR_DEBUG is set', () => {
      const stderr = new PassThrough();
      const chunks: Buffer[] = [];
      stderr.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      writeDebugNote('tree changed', { NMR_DEBUG: '1' }, stderr);

      expect(Buffer.concat(chunks).toString('utf8')).toContain('tree changed');
    });
  });
});
