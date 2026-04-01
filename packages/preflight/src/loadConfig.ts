import { existsSync } from 'node:fs';
import path from 'node:path';

import type { PreflightConfig, ResolvedPreflightConfig } from './types.ts';

/** Default config values when no config file is found. */
const DEFAULT_CONFIG: ResolvedPreflightConfig = {
  compile: {
    srcDir: '.preflight/collections',
    outDir: '.preflight/collections',
  },
};

/** Ordered lookup paths for the config file, resolved relative to `process.cwd()`. */
const LOOKUP_PATHS = ['.config/preflight/config.ts', '.config/preflight.config.ts'];

/** Check whether a value is a plain object (non-null, non-array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate that a raw value has the expected PreflightConfig shape. */
function assertIsPreflightConfig(raw: unknown): asserts raw is PreflightConfig {
  if (!isRecord(raw)) {
    throw new TypeError(`Preflight config must be an object, got ${Array.isArray(raw) ? 'array' : typeof raw}`);
  }

  if (raw.compile !== undefined) {
    if (!isRecord(raw.compile)) {
      throw new TypeError("'compile' must be an object");
    }
    if (raw.compile.srcDir !== undefined && typeof raw.compile.srcDir !== 'string') {
      throw new TypeError("'compile.srcDir' must be a string");
    }
    if (raw.compile.outDir !== undefined && typeof raw.compile.outDir !== 'string') {
      throw new TypeError("'compile.outDir' must be a string");
    }
  }
}

/**
 * Load preflight config from the filesystem with a lookup chain.
 *
 * Checks `.config/preflight/config.ts` first, then `.config/preflight.config.ts`.
 * Returns defaults if neither exists. An explicit override path skips the lookup chain.
 */
export async function loadConfig(overridePath?: string): Promise<ResolvedPreflightConfig> {
  let resolvedPath: string | undefined;

  if (overridePath !== undefined) {
    resolvedPath = path.resolve(process.cwd(), overridePath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Preflight config not found: ${resolvedPath}`);
    }
  } else {
    for (const lookupPath of LOOKUP_PATHS) {
      const candidate = path.resolve(process.cwd(), lookupPath);
      if (existsSync(candidate)) {
        resolvedPath = candidate;
        break;
      }
    }
  }

  if (resolvedPath === undefined) {
    return { ...DEFAULT_CONFIG };
  }

  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url);
  const imported: unknown = await jiti.import(resolvedPath);

  if (!isRecord(imported)) {
    throw new Error(`Config file must export an object, got ${Array.isArray(imported) ? 'array' : typeof imported}`);
  }

  // Support both default export and named exports
  const raw = imported.default !== undefined && isRecord(imported.default) ? imported.default : imported;

  assertIsPreflightConfig(raw);

  return {
    compile: {
      srcDir: typeof raw.compile?.srcDir === 'string' ? raw.compile.srcDir : DEFAULT_CONFIG.compile.srcDir,
      outDir: typeof raw.compile?.outDir === 'string' ? raw.compile.outDir : DEFAULT_CONFIG.compile.outDir,
    },
  };
}
