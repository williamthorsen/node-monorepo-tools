import { vi } from 'vitest';

import type { ReleaseWindow } from '../enumerateReleaseWindows.ts';

// A test loads this module through `vi.hoisted`, before its `vi.mock` calls register, so the module imports nothing
// under test: Such a module would bind the real dependencies.

export const mockEnumerateReleaseWindows = vi.fn<() => ReleaseWindow[]>();
export const mockWriteFileSync = vi.fn();
