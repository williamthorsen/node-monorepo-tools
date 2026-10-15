/**
 * Core count at or below which every project gets `SMALL_MACHINE_MAX_WORKERS`, whatever the memory. Vitest's run-mode
 * default is one fewer worker than the core count, so a 2-core CI runner would run every file serially on one worker.
 * Three workers are faster there, because the main process transforms files while the workers run them.
 */
const SMALL_MACHINE_MAX_CORES = 2;

const SMALL_MACHINE_MAX_WORKERS = 3;

/**
 * Memory budgeted to each worker, in GiB. It leaves room for several concurrent test runs and other workloads, rather
 * than measuring one worker's footprint. The divisor is total memory, not free memory: `os.freemem()` on macOS
 * excludes cached pages and reports near zero.
 */
const GIB_PER_WORKER = 4;

const BYTES_PER_GIB = 2 ** 30;

const MAX_WORKERS_FLAGS = ['--maxWorkers', '--max-workers'];

const PERCENTAGE_PATTERN = /^\d+%$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

export interface MachineCapacity {
  coreCount: number;
  totalMemoryBytes: number;
}

/** Returns the worker count for a machine: one per `GIB_PER_WORKER` of memory, bounded by one fewer than the cores. */
export function deriveDefaultMaxWorkers({ coreCount, totalMemoryBytes }: MachineCapacity): number {
  if (coreCount <= SMALL_MACHINE_MAX_CORES) return SMALL_MACHINE_MAX_WORKERS;

  const memoryBound = Math.max(1, Math.floor(totalMemoryBytes / (GIB_PER_WORKER * BYTES_PER_GIB)));

  return Math.min(coreCount - 1, memoryBound);
}

/**
 * Returns the value of the last `--maxWorkers` argument: a number, or a percentage string that Vitest resolves against
 * the core count. An argument whose value is neither counts as absent, which leaves Vitest to report it.
 */
export function readMaxWorkersFlag(args: readonly string[]): number | string | undefined {
  let rawValue: string | undefined;

  args.forEach((arg, index) => {
    if (MAX_WORKERS_FLAGS.includes(arg)) {
      rawValue = args[index + 1];
      return;
    }

    const flag = MAX_WORKERS_FLAGS.find((name) => arg.startsWith(`${name}=`));
    if (flag !== undefined) rawValue = arg.slice(flag.length + 1);
  });

  return parseMaxWorkersValue(rawValue);
}

// region | Helpers

/** Converts a flag value to a worker count or a percentage, and anything else to `undefined`. */
function parseMaxWorkersValue(rawValue: string | undefined): number | string | undefined {
  if (rawValue === undefined) return undefined;
  if (POSITIVE_INTEGER_PATTERN.test(rawValue)) return Number(rawValue);
  if (PERCENTAGE_PATTERN.test(rawValue)) return rawValue;

  return undefined;
}

// endregion | Helpers
