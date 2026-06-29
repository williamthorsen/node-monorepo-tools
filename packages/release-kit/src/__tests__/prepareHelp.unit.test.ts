import { describe, expect, it, vi } from 'vitest';

import { prepareHelpText, showPrepareHelp } from '../help/prepareHelp.ts';
import { prepareFlagSchema } from '../prepareCommand.ts';

describe(prepareHelpText, () => {
  it('documents every long flag in prepareFlagSchema', () => {
    for (const flag of Object.values(prepareFlagSchema)) {
      expect(prepareHelpText).toContain(flag.long);
    }
  });

  it('documents no unrecognized --flag tokens', () => {
    // `--help` is documented but handled by the bin dispatcher, so it is not in the schema.
    const known = new Set<string>([...Object.values(prepareFlagSchema).map((flag) => flag.long), '--help']);
    const documented = prepareHelpText.match(/--[a-z][a-z-]*/g) ?? [];
    for (const token of documented) {
      expect(known).toContain(token);
    }
  });

  it('documents --force and its release-even-without-commits behavior', () => {
    expect(prepareHelpText).toContain('--force');
    expect(prepareHelpText).toContain('Release even when no commits');
  });

  it('documents the project-block caveat on both --set-version and --only', () => {
    const caveats = prepareHelpText.match(/rejected when a 'project' block is configured/g);
    expect(caveats).toHaveLength(2);
  });
});

describe(showPrepareHelp, () => {
  it('prints the help text', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    showPrepareHelp();

    expect(info).toHaveBeenCalledWith(prepareHelpText);
    info.mockRestore();
  });
});
