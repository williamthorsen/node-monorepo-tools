/**
 * Reports whether `key` is a hook script name: a `:pre` or `:post` suffix preceded by at least one character.
 *
 * Reads the suffix alone, without consulting the registry for the parent command.
 */
export function isHookName(key: string): boolean {
  return (key.length > 4 && key.endsWith(':pre')) || (key.length > 5 && key.endsWith(':post'));
}
