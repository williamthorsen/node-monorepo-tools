import { DELEGATE_ENV_VAR, DELEGATE_FLAG, DELEGATE_TO_FLAG, type HostList } from './remote-run.ts';
import { type DelegateWhen, formatDisplayPath, type LoadedUserConfig, resolveUserConfigPath } from './user-config.ts';
import { hasAgentMarker } from './verbosity.ts';

/**
 * Where a delegation runs, or why the invocation cannot run where it asked to. A delegation that the user config
 * decided names the file and the `when` that matched.
 */
export type DelegationTarget =
  | { kind: 'local' }
  | { kind: 'remote'; hosts: HostList; source: 'env' | 'flag' }
  | { kind: 'remote'; hosts: HostList; source: 'config'; configPath: string; when: DelegateWhen }
  | { kind: 'refused'; error: string };

/**
 * Decides where an invocation runs, by the first rule that applies:
 *
 * 1. `--no-delegate` runs it here.
 * 2. `--delegate-to` runs it on the hosts that it names, and `--delegate` on `NMR_DELEGATE`'s, or else the user
 *    config's.
 * 3. A repo config declaring `delegate: false` runs it here.
 * 4. `NMR_DELEGATE` naming hosts runs it on them.
 * 5. `NMR_DELEGATE` set without a host runs it here, which is how a step keeps to where its parent runs.
 * 6. The user config's `when` matching runs it on the config's hosts, unless `CI` is set or the invocation fans out.
 * 7. Otherwise, it runs here.
 *
 * A command that rewrites the tree, or that runs until it is stopped, cannot be delegated, and neither can `--log`,
 * which reads this machine's recordings. Asked for by a flag, such an invocation is refused; asked for by the
 * variable or the user config, which set a default for every invocation, it runs here.
 *
 * The user config is read only when a rule reaches it, so an invalid one fails only a run that consults it.
 */
export async function resolveDelegationTarget(options: {
  command: string;
  env: NodeJS.ProcessEnv;
  extraAgentEnvVars: readonly string[] | undefined;
  flagValue: string | undefined;
  isFanOut: boolean;
  isOptedOut: boolean;
  isReading: boolean;
  isRepoOptedOut: boolean;
  readUserConfig: () => Promise<LoadedUserConfig | undefined>;
  shouldDelegate: boolean;
}): Promise<DelegationTarget> {
  const { command, env, extraAgentEnvVars, flagValue, isFanOut, isOptedOut, isReading } = options;
  const { isRepoOptedOut, readUserConfig, shouldDelegate } = options;
  if (isOptedOut) {
    return { kind: 'local' };
  }

  const isDelegable = !isReading && !NON_DELEGABLE_COMMANDS.has(command);
  const envValue = env[DELEGATE_ENV_VAR];
  const envHosts = parseHostList(envValue ?? '');

  if (flagValue !== undefined || shouldDelegate) {
    return resolveRequestedTarget({ command, env, envHosts, flagValue, isDelegable, isReading, readUserConfig });
  }

  if (isRepoOptedOut) {
    return { kind: 'local' };
  }
  if (envHosts !== undefined) {
    return isDelegable ? { kind: 'remote', hosts: envHosts, source: 'env' } : { kind: 'local' };
  }
  if (envValue !== undefined || !isDelegable || isFanOut || hasValue(env['CI'])) {
    return { kind: 'local' };
  }

  const loaded = await readUserConfig();
  const delegate = loaded?.config.delegate;
  if (loaded === undefined || delegate?.when === undefined) {
    return { kind: 'local' };
  }
  if (delegate.when === 'agent' && !hasAgentMarker(env, extraAgentEnvVars)) {
    return { kind: 'local' };
  }

  return { kind: 'remote', hosts: delegate.hosts, source: 'config', configPath: loaded.path, when: delegate.when };
}

// region | Helpers

/** Names the user config in a message when the environment does not locate one. */
const DEFAULT_USER_CONFIG_PATH = '~/.config/nmr/config.ts';

/** Commands that rewrite the working tree or run until stopped, which a delegation could not report back. */
const NON_DELEGABLE_BASE_COMMANDS = ['build', 'clean', 'compile', 'fix', 'fmt', 'lint', 'test:watch', 'upgrade'];

const NON_DELEGABLE_COMMANDS: ReadonlySet<string> = new Set([
  ...NON_DELEGABLE_BASE_COMMANDS,
  ...NON_DELEGABLE_BASE_COMMANDS.map((command) => `root:${command}`),
]);

/** Reports whether an environment variable is set to a non-empty value. */
function hasValue(value: string | undefined): boolean {
  return value !== undefined && value !== '';
}

/**
 * Splits a comma-separated host list, dropping whitespace, empty entries, and repeats. Returns `undefined` when the
 * value does not name a host.
 */
function parseHostList(value: string): HostList | undefined {
  const names = value.split(',').map((host) => host.trim());
  const [first, ...rest] = new Set(names.filter((host) => host !== ''));

  return first === undefined ? undefined : [first, ...rest];
}

/**
 * Resolves an invocation that a flag asked to delegate: to the hosts that `--delegate-to` names, or for `--delegate`,
 * to `NMR_DELEGATE`'s when it names any and to the user config's otherwise. An empty `NMR_DELEGATE`, which marks a
 * step, does not stand in the way of a flag that asks for hosts.
 */
async function resolveRequestedTarget(options: {
  command: string;
  env: NodeJS.ProcessEnv;
  envHosts: HostList | undefined;
  flagValue: string | undefined;
  isDelegable: boolean;
  isReading: boolean;
  readUserConfig: () => Promise<LoadedUserConfig | undefined>;
}): Promise<DelegationTarget> {
  const { command, env, envHosts, flagValue, isDelegable, isReading, readUserConfig } = options;
  const flag = flagValue === undefined ? DELEGATE_FLAG : DELEGATE_TO_FLAG;

  const flagHosts = flagValue === undefined ? undefined : parseHostList(flagValue);
  if (flagValue !== undefined && flagHosts === undefined) {
    return { kind: 'refused', error: `${DELEGATE_TO_FLAG} requires a host: "${flagValue}" does not name a host.` };
  }
  if (!isDelegable) {
    const subject = isReading ? '--log' : `\`${command}\``;
    const reason = isReading ? "reads this machine's recordings" : 'rewrites the working tree or runs until stopped';
    return { kind: 'refused', error: `${subject} cannot be delegated: it ${reason}. Run it without ${flag}.` };
  }

  const hosts = flagHosts ?? envHosts ?? (await readUserConfig())?.config.delegate?.hosts;
  if (hosts === undefined) {
    const configPath = formatDisplayPath(resolveUserConfigPath(env) ?? DEFAULT_USER_CONFIG_PATH, env);
    return {
      kind: 'refused',
      error:
        `${DELEGATE_FLAG} needs hosts: set \`delegate.hosts\` in ${configPath}, or name them with ` +
        `${DELEGATE_TO_FLAG} <host,...>.`,
    };
  }

  return { kind: 'remote', hosts, source: 'flag' };
}

// endregion | Helpers
