import { insertBeforeTerminator, readFlag } from './taze-args.ts';

/** One run of taze: the arguments that it receives and, in a split run, the heading printed before it. */
export interface TazePass {
  args: string[];
  heading?: string;
}

/** Every spelling that taze's CLI accepts for the maturity-period flag. */
const MATURITY_PERIOD_FLAGS = ['--maturity-period', '--maturityPeriod'];

/**
 * Splits a taze invocation into one pass per `packageMaturityPeriod` entry and one for every other dependency.
 *
 * Each pass is confined by `--exclude` alone: taze subtracts every `--exclude` value from the dependencies that it
 * checks, so the invocation's own `--include` and `--exclude` narrow each pass as they narrow a single run. An
 * entry pass excludes every package that its key does not match or that an earlier key matches, so that the first
 * matching key decides a package's period. A maturity period given on the command line applies to every
 * dependency, so it returns the invocation as a single pass.
 *
 * Throws when `packageMaturityPeriod` is not a record of glob keys to non-negative periods. A key cannot be a regex,
 * contain a comma, or name a version (`name@range`), each of which taze reads as something other than a name glob.
 */
export function planTazePasses(args: readonly string[], packageMaturityPeriod: unknown): TazePass[] {
  const entries = validatePackageMaturityPeriod(packageMaturityPeriod);
  if (entries.length === 0 || readFlag(args, MATURITY_PERIOD_FLAGS) !== undefined) return [{ args: [...args] }];

  const keys = entries.map(([key]) => key);
  const entryPasses = entries.map(([key, days], index) => ({
    args: insertBeforeTerminator(args, [
      '--maturity-period',
      String(days),
      '--exclude',
      composeComplementFilter(key, keys.slice(0, index)),
    ]),
    heading: `Packages matching ${key}: ${days}-day maturity period`,
  }));
  const remainderPass = {
    args: insertBeforeTerminator(args, ['--exclude', keys.join(',')]),
    heading: 'All other packages: configured maturity period',
  };

  return [...entryPasses, remainderPass];
}

// region | Helpers

/**
 * Returns a taze filter, in its `/body/` regex form, that matches every name that `key` does not match or that
 * one of `earlierKeys` matches.
 */
function composeComplementFilter(key: string, earlierKeys: readonly string[]): string {
  const outsideKey = `^(?!${convertGlobToRegexBody(key)}$)`;
  if (earlierKeys.length === 0) return `/${outsideKey}/`;
  return `/${outsideKey}|^(?:${earlierKeys.map(convertGlobToRegexBody).join('|')})$/`;
}

/** Converts a glob to the unanchored regex source that taze's `filterToRegex` builds from it. */
function convertGlobToRegexBody(glob: string): string {
  return glob.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`).replaceAll(/\*+/g, '.*?');
}

/** Returns the entries of a valid `packageMaturityPeriod`, in declaration order. */
function validatePackageMaturityPeriod(value: unknown): Array<[string, number]> {
  if (value === undefined) return [];
  if (!isPlainObject(value)) {
    throw new Error('packageMaturityPeriod must be an object mapping package patterns to periods in days');
  }

  return Object.entries(value).map(([key, days]): [string, number] => {
    if (key.startsWith('/')) {
      throw new Error(`packageMaturityPeriod entry '${key}': keys are package names with * wildcards, not regexes`);
    }
    if (key.includes(',')) {
      throw new Error(`packageMaturityPeriod entry '${key}': a key cannot contain a comma`);
    }
    if (key.lastIndexOf('@') > 0) {
      throw new Error(`packageMaturityPeriod entry '${key}': a key names packages, not a version selector`);
    }
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 0) {
      throw new Error(`packageMaturityPeriod entry '${key}': the period must be a non-negative number of days`);
    }
    return [key, days];
  });
}

/** Reports whether `value` is an object created as a literal or by `Object.create(null)`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// endregion | Helpers
