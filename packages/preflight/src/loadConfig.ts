import { existsSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { isRecord } from './isRecord.ts';
import { jitiImport } from './jitiImport.ts';
import type { PreflightConfig, ResolvedPreflightConfig } from './types.ts';

/** Default config values when no config file is found. */
const DEFAULT_CONFIG: ResolvedPreflightConfig = {
  compile: {
    srcDir: '.preflight/distribution',
    outDir: '.preflight/distribution',
  },
};

/** Ordered lookup paths for the config file, resolved relative to `process.cwd()`. */
const LOOKUP_PATHS = ['.config/preflight/config.ts', '.config/preflight.config.ts'];

/** Structural schema for PreflightConfig. */
const PreflightConfigSchema = z.looseObject({
  compile: z
    .looseObject({
      srcDir: z.string().optional(),
      outDir: z.string().optional(),
    })
    .optional(),
});

/** Validate that a raw value has the expected PreflightConfig shape. */
function assertIsPreflightConfig(raw: unknown): asserts raw is PreflightConfig {
  PreflightConfigSchema.parse(raw);
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

  const imported = await jitiImport(
    resolvedPath,
    'External packages imported by the config file must be installed in the project.',
    'Config file',
  );

  // Support both default export and named exports
  const raw = imported.default !== undefined && isRecord(imported.default) ? imported.default : imported;

  assertIsPreflightConfig(raw);

  // Guard is redundant at runtime (Zod already validated) but needed for type narrowing
  // because `raw` is `Record<string, unknown> & PreflightConfig` after the assertion.
  const compile = isRecord(raw.compile) ? raw.compile : undefined;
  return {
    compile: {
      srcDir: typeof compile?.srcDir === 'string' ? compile.srcDir : DEFAULT_CONFIG.compile.srcDir,
      outDir: typeof compile?.outDir === 'string' ? compile.outDir : DEFAULT_CONFIG.compile.outDir,
    },
  };
}
