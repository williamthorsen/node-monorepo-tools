import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reportOverrides } from '../../src/commands/report-overrides.js';

describe('reportOverrides', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-report-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
    vi.restoreAllMocks();
  });

  it('does nothing when no overrides exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportOverrides(tmpDir);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('reports active pnpm overrides', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test',
        version: '1.0.0',
        pnpm: { overrides: { 'some-package': '1.2.3' } },
      }),
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportOverrides(tmpDir);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pnpm overrides are active'));
    expect(warnSpy).toHaveBeenCalledWith('- some-package → 1.2.3');
  });

  it('does nothing when overrides object is empty', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test',
        version: '1.0.0',
        pnpm: { overrides: {} },
      }),
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportOverrides(tmpDir);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
