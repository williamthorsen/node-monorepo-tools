import { realpathSync } from 'node:fs';
import process from 'node:process';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect, it } from 'vitest';

import { spawnInherited } from '../spawn-inherited.ts';

// The child inherits the worker's stdio, which the uncaptured-output guard cannot see, so each child writes nothing
// and reports what it observed through its exit status.
describe(spawnInherited, () => {
  it('runs the program in the given directory with the given environment', () => {
    using tree = createTempTree({}, { prefix: 'nmr-spawn-inherited-tool-test-' });
    const script = `process.exit(process.cwd() === ${JSON.stringify(realpathSync(tree.dir))} && process.env.PROBE === 'yes' ? 0 : 7)`;

    const outcome = spawnInherited(process.execPath, ['-e', script], { cwd: tree.dir, env: { PROBE: 'yes' } });

    expect(outcome).toStrictEqual({ error: undefined, signal: null, status: 0 });
  });

  it('reports the signal that ended the program', () => {
    const outcome = spawnInherited(process.execPath, ['-e', "process.kill(process.pid, 'SIGTERM')"]);

    expect(outcome).toMatchObject({ signal: 'SIGTERM', status: null });
  });

  it('reports a program that cannot be started as an error', () => {
    const outcome = spawnInherited('/nonexistent/nmr-spawn-inherited-probe', []);

    expect(outcome.error).toBeInstanceOf(Error);
  });
});
