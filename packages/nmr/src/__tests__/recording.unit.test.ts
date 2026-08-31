import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { type CheckCacheEntry, recordTranscript, writeCheckCacheEntry } from '../check-cache.ts';
import { type Recording, renderRecording, renderRefusal, resolveRecording } from '../recording.ts';

const COMMAND = 'test';
const KEY = 'a-key';
const SCOPE = 'nmr-core';

/** What the fixture's entries were recorded under, which a mismatch test varies one ingredient of. */
const IDENTITY = {
  commandString: 'vitest run',
  nmrVersion: '1.0.0',
  nodeVersion: 'v24.0.0',
  treeHash: 'a-tree',
};

describe('a recording', () => {
  let root: string;

  beforeEach(() => {
    root = disposeOnTestFinished(createTempTree({ 'node_modules/': '' }, { prefix: 'nmr-recording-' })).dir;
  });

  describe(resolveRecording, () => {
    it('given a pass recorded on this tree, returns it with the transcript beside it', async () => {
      await writeCheckCacheEntry({ ...refFor(), entry: makeEntry() });
      await recordTranscript(refFor(), 'Test Files  6 passed (6)\n');

      const lookup = await resolveRecording(lookupFor());

      expect(lookup).toMatchObject({ ok: true, recording: { transcript: 'Test Files  6 passed (6)\n' } });
    });

    it('given a composite, returns the assembly it recorded and no transcript', async () => {
      const retention = { key: 'a-retention-key', runId: 'a-run', replay: [replayLine()] };
      await writeCheckCacheEntry({ ...refFor(), entry: { ...makeEntry(), retention } });

      const recording = await resolveOrThrow();

      expect(recording.transcript).toBeUndefined();
      expect(recording.entry.retention?.replay).toStrictEqual([replayLine()]);
    });

    it('given a command outside the cacheable set, refuses without reading an entry', async () => {
      await writeCheckCacheEntry({ ...refFor(), entry: makeEntry() });
      await recordTranscript(refFor(), 'output');

      const lookup = await resolveRecording({ ...lookupFor(), isCacheable: false });

      expect(lookup).toStrictEqual({ ok: false, refusal: { kind: 'uncacheable' } });
    });

    it('given a gate standing aside, refuses rather than reading an entry it cannot vouch for', async () => {
      await writeCheckCacheEntry({ ...refFor(), entry: makeEntry() });

      const lookup = await resolveRecording({ ...lookupFor(), key: undefined });

      expect(lookup).toStrictEqual({ ok: false, refusal: { kind: 'gate-aside' } });
    });

    it('given nothing recorded at all, refuses', async () => {
      const lookup = await resolveRecording(lookupFor());

      expect(lookup).toStrictEqual({ ok: false, refusal: { kind: 'unrecorded' } });
    });

    // The same admission a skip is held to, so `--log` shows what would have been recalled and nothing else.
    it('given a pass recorded under another key, refuses and reports its age', async () => {
      const recordedAt = new Date(Date.now() - 120_000).toISOString();
      await writeCheckCacheEntry({ ...refFor(), entry: { ...makeEntry(), key: 'another-key', recordedAt } });
      await recordTranscript(refFor(), 'output from another tree');

      const lookup = await resolveRecording(lookupFor());

      expect(lookup).toMatchObject({ ok: false, refusal: { kind: 'mismatched', ageMs: expect.any(Number) } });
      expect(lookup).not.toMatchObject({ ok: true });
    });

    // The key folds in the install, the interpreter, and the chain that would run, so attributing every
    // mismatch to the tree sends a reader with a clean `git status` looking in the wrong place.
    it.each([
      ['the tree moved', { treeHash: 'another-tree' }, { ingredient: 'tree' }],
      ['the chain changed', { commandString: 'vitest run --coverage' }, { ingredient: 'command-string' }],
      ['nmr was upgraded', { nmrVersion: '1.1.0' }, { ingredient: 'nmr-version', current: '1.1.0', recorded: '1.0.0' }],
      [
        'Node was upgraded',
        { nodeVersion: 'v25.0.0' },
        { ingredient: 'node-version', current: 'v25.0.0', recorded: 'v24.0.0' },
      ],
      ['only the install moved', {}, { ingredient: 'other' }],
    ])('given %s, names the ingredient that moved', async (_scenario, current, difference) => {
      await writeCheckCacheEntry({ ...refFor(), entry: { ...makeEntry(), key: 'another-key' } });

      const lookup = await resolveRecording({ ...lookupFor(), current: { ...IDENTITY, ...current } });

      expect(lookup).toMatchObject({ ok: false, refusal: { difference } });
    });

    it('leaves the tree unattributed where no snapshot was taken', async () => {
      await writeCheckCacheEntry({ ...refFor(), entry: { ...makeEntry(), key: 'another-key' } });

      const lookup = await resolveRecording({ ...lookupFor(), current: { ...IDENTITY, treeHash: undefined } });

      expect(lookup).toMatchObject({ ok: false, refusal: { difference: { ingredient: 'other' } } });
    });

    it('given a pass that retained nothing, refuses', async () => {
      await writeCheckCacheEntry({ ...refFor(), entry: makeEntry() });

      const lookup = await resolveRecording(lookupFor());

      expect(lookup).toMatchObject({ ok: false, refusal: { kind: 'no-output' } });
    });

    // The retention key certifies that a recording describes this presentation environment, which is what a
    // replayed excerpt needs and what a dated recording does not.
    it('prints a recording made under another presentation environment', async () => {
      const retention = { key: 'a-key-from-another-terminal', runId: 'a-run', replay: [replayLine()] };
      await writeCheckCacheEntry({ ...refFor(), entry: { ...makeEntry(), retention } });
      await recordTranscript(refFor(), 'output recorded through a pipe\n');

      const lookup = await resolveRecording(lookupFor());

      expect(lookup).toMatchObject({ ok: true, recording: { transcript: 'output recorded through a pipe\n' } });
    });
  });

  describe(renderRecording, () => {
    it('leads with the instant, the age, the duration, and the command string', () => {
      const recordedAt = new Date(Date.now() - 60_000).toISOString();
      const entry = { ...makeEntry(), recordedAt, durationMs: 12_400, commandString: 'vitest --project unit' };

      const rendered = renderRecording({ command: COMMAND, recording: { entry }, scope: SCOPE });

      expect(rendered.split('\n', 1)[0]).toBe(
        `📼 ${SCOPE}: ${COMMAND} — recorded ${recordedAt} (1m ago), ran in 12.4s`,
      );
      expect(rendered.split('\n', 2)[1]).toBe('$ vitest --project unit');
    });

    it('prints the transcript below a blank line, as the run wrote it', () => {
      const recording: Recording = { entry: makeEntry(), transcript: 'first\nlast\n' };

      const rendered = renderRecording({ command: COMMAND, recording, scope: SCOPE });

      expect(rendered.endsWith('\nfirst\nlast\n')).toBe(true);
      expect(rendered).toContain('\n\nfirst');
    });

    it('terminates a transcript that does not terminate itself', () => {
      const recording: Recording = { entry: makeEntry(), transcript: 'no trailing newline' };

      expect(renderRecording({ command: COMMAND, recording, scope: SCOPE }).endsWith('no trailing newline\n')).toBe(
        true,
      );
    });

    it('given a composite, prints one attributed line per excerpt', () => {
      const replay = [replayLine(), { command: 'lint:check', excerpt: 'no problems', scope: 'nmr' }];
      const entry = { ...makeEntry(), retention: { key: 'a-retention-key', runId: 'a-run', replay } };

      const rendered = renderRecording({ command: 'check', recording: { entry }, scope: SCOPE });

      expect(rendered).toContain('nmr-core: typecheck: no errors\nnmr: lint:check: no problems\n');
    });
  });

  describe(renderRefusal, () => {
    it.each([
      ['uncacheable', { kind: 'uncacheable' }, 'is outside the check-result cache'],
      ['gate-aside', { kind: 'gate-aside' }, 'standing aside here'],
      ['unrecorded', { kind: 'unrecorded' }, 'nothing has recorded a pass'],
      [
        'a moved tree',
        { kind: 'mismatched', ageMs: 60_000, difference: { ingredient: 'tree' } },
        'the last pass was 1m ago, on a tree this is not',
      ],
      [
        'a changed chain',
        { kind: 'mismatched', ageMs: 60_000, difference: { ingredient: 'command-string' } },
        'over a command chain this is not',
      ],
      [
        'an upgraded nmr',
        {
          kind: 'mismatched',
          ageMs: 60_000,
          difference: { ingredient: 'nmr-version', current: '1.1.0', recorded: '1.0.0' },
        },
        'under nmr 1.0.0, not 1.1.0',
      ],
      [
        'an upgraded Node',
        {
          kind: 'mismatched',
          ageMs: 60_000,
          difference: { ingredient: 'node-version', current: 'v25.0.0', recorded: 'v24.0.0' },
        },
        'under Node v24.0.0, not v25.0.0',
      ],
      [
        'an ingredient the entry does not record',
        { kind: 'mismatched', ageMs: 60_000, difference: { ingredient: 'other' } },
        'under an install or environment this run does not share',
      ],
      ['no-output', { kind: 'no-output', ageMs: 60_000 }, 'the pass 1m ago retained none'],
    ] as const)('given %s, names the scope, the command, and what is missing', (_kind, refusal, clause) => {
      const rendered = renderRefusal({ command: COMMAND, refusal, scope: SCOPE });

      expect(rendered.startsWith(`📭 ${SCOPE}: ${COMMAND}: no recording; `)).toBe(true);
      expect(rendered).toContain(clause);
    });

    it('stays on one line, so a fan-out’s gaps stay attributable', () => {
      expect(renderRefusal({ command: COMMAND, refusal: { kind: 'unrecorded' }, scope: SCOPE })).not.toContain('\n');
    });
  });

  // region | Helpers

  /** A pass recorded moments ago, which a test varies where the variance is the subject. */
  function makeEntry(): CheckCacheEntry {
    return {
      key: KEY,
      treeHash: IDENTITY.treeHash,
      headSha: 'a-head',
      commandString: IDENTITY.commandString,
      nmrVersion: IDENTITY.nmrVersion,
      nodeVersion: IDENTITY.nodeVersion,
      durationMs: 1_000,
      recordedAt: new Date().toISOString(),
      buildDigests: {},
    };
  }

  /** Resolves what this scope has to show, failing the test where it has nothing. */
  async function resolveOrThrow(): Promise<Recording> {
    const lookup = await resolveRecording(lookupFor());
    if (!lookup.ok) {
      throw new Error(`expected a recording, got: ${lookup.refusal.kind}`);
    }
    return lookup.recording;
  }

  function lookupFor() {
    return { ...refFor(), current: { ...IDENTITY }, isCacheable: true, key: KEY };
  }

  function refFor() {
    return { anchorDir: root, command: COMMAND, monorepoRoot: root };
  }

  function replayLine() {
    return { command: 'typecheck', excerpt: 'no errors', scope: 'nmr-core' };
  }

  // endregion | Helpers
});
