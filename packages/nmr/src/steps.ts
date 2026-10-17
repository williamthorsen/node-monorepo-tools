import {
  dropLeadingAssignments,
  isShellSafeToken,
  quoteToken,
  splitSegments,
  tokenize,
  tokenizeSegment,
} from './shell-syntax.ts';

/**
 * The programs that run another program named by a later token, each mapped to the subcommands through which
 * it runs a binary. An empty set means the program follows the launcher directly, after any flags.
 *
 * Requiring the subcommand for the rest keeps `pnpm --filter nmr build` from reading as a crossing in a repo
 * containing a package named `nmr`, and `pnpm run nmr` from reading as one at all: That runs a script by that
 * name, not the binary.
 */
const LAUNCHERS = new Map<string, ReadonlySet<string>>([
  ['bun', new Set(['x'])],
  ['bunx', new Set()],
  ['npm', new Set(['exec'])],
  ['npx', new Set()],
  ['pnpm', new Set(['dlx', 'exec'])],
  ['yarn', new Set(['dlx', 'exec'])],
]);

/**
 * One element of a resolved command chain, recording how it was composed rather than how its text reads.
 * A `structural` step is nmr's own composition, stored as argv; an `opaque` step is a command that nmr does not
 * parse.
 *
 * A structural step's argv leads with the file to spawn, so the runner has one to hand `spawn` without a shell.
 *
 * `shouldDeclineArguments` is passed from the composite element that composed the step to the one reader that acts
 * on it, the binding of the invocation's trailing arguments. Every stage between the two passes it through unread.
 *
 * `shouldRunInBackground` and `shouldWithholdInput` are read by the runner alone. The first starts the step without
 * waiting for it; the second gives the step's child the null device as stdin rather than nmr's own. Like
 * `shouldDeclineArguments`, each is set only when it holds and leaves the rendered chain unchanged.
 */
export type Step =
  | { kind: 'opaque'; command: string }
  | {
      kind: 'structural';
      argv: readonly [string, ...(readonly string[])];
      shouldDeclineArguments?: boolean;
      shouldRunInBackground?: boolean;
      shouldWithholdInput?: boolean;
    };

/** The declarations that a composite element adds to the step that it composes. */
export interface StepFlags {
  shouldDeclineArguments?: boolean | undefined;
  shouldRunInBackground?: boolean | undefined;
}

/** What a structural step asks of the nmr process that it spawns. */
export interface NmrStepTarget {
  command: string;
  /** Whether the command is fanned out to other scopes, as it is when a `-R` or `-F` sends it. */
  isDelegate: boolean;
  /**
   * Whether the command is fanned out to every package, as it is when a `-R` sends it. A separate field rather
   * than a narrowing of `isDelegate`, whose reader surveys the scopes that a `-F` may also have reached.
   */
  isRecursive: boolean;
  /** Whether the command runs against the root registry, as it does when a `-w` anchors it. */
  isWorkspaceRoot: boolean;
}

/**
 * How an entry names the command under which it is declared: as its whole value, or alongside other steps.
 * `sole` covers an entry with trailing arguments, which do not declare a step of their own.
 */
export type SelfReference = 'chained' | 'sole';

/**
 * Where an entry resolves, which decides the scopes that `-w`, `-R`, and `-F` send its command to:
 * - `root`: the root's `package.json` or the config's `rootScripts`, resolved at the monorepo root.
 * - `package`: a non-root package's own `package.json`, resolved in that package alone.
 * - `workspaceRegistry`: the config's `workspaceScripts`, resolved in every package that does not override the
 *   command.
 */
export type SelfReferenceScope = 'package' | 'root' | 'workspaceRegistry';

/**
 * Composes the structural step that re-invokes nmr for one composite element.
 *
 * The element tokenizes on whitespace, so it may contain nmr's own flags but cannot contain a space-bearing
 * token. `-w` is prepended as its own token: The child selects the root registry on its own.
 *
 * Because each flag is set only when it holds, a step composed with a flag at `false` compares equal to one
 * composed without it.
 */
export function composeNmrStep(element: string, isWorkspaceRoot: boolean, flags: StepFlags = {}): Step {
  const { shouldDeclineArguments = false, shouldRunInBackground = false } = flags;
  const nmrFlags = isWorkspaceRoot ? ['-w'] : [];
  return {
    kind: 'structural',
    argv: ['nmr', ...nmrFlags, ...tokenize(element)],
    ...(shouldDeclineArguments && { shouldDeclineArguments }),
    ...(shouldRunInBackground && { shouldRunInBackground }),
  };
}

/**
 * Returns the steps that still run in a workspace without any package: every step but the ones that a `-R` fans
 * out.
 *
 * A `-F` step is kept. It names one package, and its absence is a real error whoever composed the step, whereas
 * a `-R` asked for every package and a workspace with none has nothing for it to do.
 */
export function dropRecursiveSteps(steps: readonly Step[]): Step[] {
  return steps.filter((step) => readNmrStep(step)?.isRecursive !== true);
}

/**
 * Returns the text of the first opaque step that runs nmr through a shell, or `undefined` when none does.
 *
 * Recognizes nmr in command position: at the start of the step, after `&&`, `||`, `;`, `|`, or a newline, past
 * any leading environment assignments, and behind a launcher such as `npx` or `pnpm exec`. A separator inside
 * quotes does not open a command position, so a command merely naming nmr in an argument is not a crossing.
 *
 * Partial by construction, and partial in stated ways rather than arbitrary ones: A value-taking flag standing
 * immediately before the program name hides it (`npx -p foo nmr`), and a launcher outside `LAUNCHERS` goes
 * unreported. What it finds is the boundary below which nmr cannot tell its own processes from the tools that
 * it runs.
 */
export function findNmrCrossing(steps: readonly Step[]): string | undefined {
  for (const step of steps) {
    if (step.kind === 'opaque' && splitSegments(step.command).some((segment) => readNmrTail(segment) !== undefined)) {
      return step.command;
    }
  }
  return undefined;
}

/**
 * Returns the first token of a composite element that falls outside the grammar, or `undefined` when the
 * element is a command name optionally preceded by nmr's own flags. A token that the shell would not read
 * literally would be quoted whole by the rendering, turning the element into a command that nobody wrote.
 */
export function findUnexpressibleToken(element: string): string | undefined {
  return tokenize(element).find((token) => !isShellSafeToken(token));
}

/**
 * Returns the command that a structural step's nmr process runs, whether the step hands that command to other
 * scopes rather than running it in its own scope, and whether it anchors the command at the monorepo root.
 * Reports nothing for a step that does not name an nmr command.
 *
 * The inverse of `composeNmrStep`, and beside it because the two share one grammar: An element may lead with
 * nmr's own flags, and the command is the first token that is not one.
 */
export function readNmrStep(step: Step): NmrStepTarget | undefined {
  if (step.kind !== 'structural') {
    return undefined;
  }

  const [file, ...rest] = step.argv;

  return file === 'nmr' ? readNmrTarget(rest) : undefined;
}

/**
 * Reports whether a string entry re-invokes the command under which it is declared, and whether it declares
 * anything besides. Reports nothing for an entry that names another command, or none.
 *
 * Honouring such an entry would spawn a shell running the same command in a scope that reads the same entry
 * again, without bound. `chained` separates an entry that thereby loses steps from one that declares nothing to
 * lose.
 *
 * Partial in the same ways `findNmrCrossing` is, and for the same reason: What goes unrecognized re-enters once,
 * and the run fails when `enterChain` finds the command repeated in the same directory.
 */
export function readSelfReference(options: {
  commandName: string;
  scope: SelfReferenceScope;
  script: string;
}): SelfReference | undefined {
  const { commandName, scope, script } = options;

  const segments = splitSegments(script).filter((segment) => segment.trim() !== '');
  const doesReenter = segments.some((segment) => {
    const invocation = readNmrTail(segment);
    const target = invocation === undefined ? undefined : readNmrTarget(invocation.tail);
    if (invocation === undefined || target === undefined) {
      return false;
    }

    const launcherScope = readLauncherScope(invocation.launcher, invocation.launcherArgs);
    const effectiveTarget = {
      command: target.command,
      isDelegate: target.isDelegate || launcherScope.isDelegate,
      isRecursive: target.isRecursive || launcherScope.isRecursive,
      isWorkspaceRoot: target.isWorkspaceRoot || launcherScope.isWorkspaceRoot,
    };

    return isReentry(effectiveTarget, commandName, scope);
  });

  if (!doesReenter) {
    return undefined;
  }

  return segments.length === 1 ? 'sole' : 'chained';
}

/**
 * Returns the command that a string script names when its whole value is `nmr <command>`, or `undefined` for any
 * other value.
 *
 * Exact by design: A flag, an argument, an environment assignment, or a launcher each change what the invocation
 * runs, or where, so a value that contains one is not interchangeable with the script that it names.
 */
export function readSoleNmrCommand(script: string): string | undefined {
  const segments = splitSegments(script).filter((segment) => segment.trim() !== '');
  if (segments.length !== 1) {
    return undefined;
  }

  const [program, command, ...rest] = tokenizeSegment(segments[0] ?? '');
  if (program !== 'nmr' || command === undefined || rest.length > 0) {
    return undefined;
  }

  return isShellSafeToken(command) && !command.startsWith('-') ? command : undefined;
}

/**
 * Reports whether a step list names the command under which it is declared, and whether it declares anything
 * besides. Takes each element's instruction: the bare string, or a spec's `run`.
 *
 * Reads an element as the instruction that nmr composes into `nmr <element>`, and applies the declaring scope
 * directly rather than through the `-w` that composition adds at the root.
 */
export function readStepListSelfReference(options: {
  commandName: string;
  elements: readonly string[];
  scope: SelfReferenceScope;
}): SelfReference | undefined {
  const { commandName, elements, scope } = options;

  const doesReenter = elements.some((element) => {
    const target = readNmrTarget(tokenize(element));

    return target !== undefined && isReentry(target, commandName, scope);
  });

  if (!doesReenter) {
    return undefined;
  }

  return elements.length === 1 ? 'sole' : 'chained';
}

/**
 * Renders a step list as the `&&` chain that a shell runs.
 *
 * The sole producer of a chain string: The check-result cache keys on that string, so a change to the rendering
 * invalidates every recorded pass.
 */
export function renderChain(steps: readonly Step[]): string {
  return steps.map(renderStep).join(' && ');
}

// region | Helpers

/**
 * Reports whether an nmr invocation declared in `scope` reaches the entry that declares it.
 *
 * A `-R` fans out from the root to every package, never to the root itself; a `-F` reaches the packages that it
 * selects; a `-w` reaches the root. Delegation outranks `-w`, as it does when nmr parses its arguments. A
 * package's `-F` selecting that package itself is not recognized.
 */
function isReentry(target: NmrStepTarget, commandName: string, scope: SelfReferenceScope): boolean {
  if (target.command !== commandName) {
    return false;
  }

  switch (scope) {
    case 'root':
      return !target.isDelegate;
    case 'package':
      return target.isRecursive || (!target.isDelegate && !target.isWorkspaceRoot);
    case 'workspaceRegistry':
      return target.isDelegate || !target.isWorkspaceRoot;
  }
}

/**
 * Returns the scope flags that pnpm applies to the nmr that it launches: `-r` fans it out to every package, `-F`
 * to the packages that it selects, and `-w` runs it at the root. Other launchers run nmr where they stand.
 */
function readLauncherScope(
  launcher: string | undefined,
  launcherArgs: readonly string[],
): Omit<NmrStepTarget, 'command'> {
  const scope = { isDelegate: false, isRecursive: false, isWorkspaceRoot: false };
  if (launcher !== 'pnpm') {
    return scope;
  }

  for (const token of launcherArgs) {
    if (token === '-r' || token === '--recursive') {
      scope.isDelegate = true;
      scope.isRecursive = true;
    } else if (token === '-F' || token === '--filter' || token.startsWith('--filter=')) {
      scope.isDelegate = true;
    } else if (token === '-w' || token === '--workspace-root') {
      scope.isWorkspaceRoot = true;
    }
  }

  return scope;
}

/**
 * Returns the tokens in an nmr invocation, or `undefined` for a segment that runs something else. nmr is
 * recognized whether named directly or run through a launcher, whose tokens ahead of `nmr` are returned as
 * `launcherArgs`.
 */
function readNmrTail(
  segment: string,
): { launcher: string | undefined; launcherArgs: readonly string[]; tail: readonly string[] } | undefined {
  const [head, ...rest] = dropLeadingAssignments(tokenizeSegment(segment));

  if (head === undefined) {
    return undefined;
  }
  if (head === 'nmr') {
    return { launcher: undefined, launcherArgs: [], tail: rest };
  }

  const subcommands = LAUNCHERS.get(head);
  if (subcommands === undefined) {
    return undefined;
  }

  const nmrIndex =
    subcommands.size === 0
      ? rest.findIndex((token) => !token.startsWith('-'))
      : rest.findIndex((token) => subcommands.has(token)) + 1;
  if (nmrIndex <= 0 && subcommands.size > 0) {
    return undefined;
  }

  return rest[nmrIndex] === 'nmr'
    ? { launcher: head, launcherArgs: rest.slice(0, nmrIndex), tail: rest.slice(nmrIndex + 1) }
    : undefined;
}

/**
 * Returns what the tokens following `nmr` ask of it: the command they name, and the flags that decide which
 * scopes run it. Reports nothing for tokens that do not name a command.
 *
 * The one reader of nmr's own flag grammar, shared by the argv of a structural step and the shell segment of an
 * opaque one, so the two cannot drift apart.
 */
function readNmrTarget(tokens: readonly string[]): NmrStepTarget | undefined {
  let isDelegate = false;
  let isRecursive = false;
  let isWorkspaceRoot = false;
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index] ?? '';

    switch (token) {
      // The pattern is the flag's value, and reading it as a command name would name whichever package it
      // selects rather than the command that every selected scope runs.
      case '-F':
      case '--filter':
        isDelegate = true;
        index += 2;
        break;
      case '-R':
      case '--recursive':
        isDelegate = true;
        isRecursive = true;
        index += 1;
        break;
      case '-w':
      case '--workspace-root':
        isWorkspaceRoot = true;
        index += 1;
        break;
      default:
        if (!token.startsWith('-')) {
          return { command: token, isDelegate, isRecursive, isWorkspaceRoot };
        }
        index += 1;
    }
  }

  return undefined;
}

/** Renders one step as the text that a shell runs. */
function renderStep(step: Step): string {
  return step.kind === 'opaque' ? step.command : step.argv.map(quoteToken).join(' ');
}

// endregion | Helpers
