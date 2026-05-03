/**
 * Returns true when `key` is a hook script name — that is, ends with the
 * `:pre` or `:post` suffix preceded by at least one character.
 *
 * Bare `:pre` and `:post` (no parent name) return false. The predicate is
 * purely about suffix shape; it does not consult the registry or care
 * whether the parent command exists.
 */
export function isHookName(key: string): boolean {
  return (key.length > 4 && key.endsWith(':pre')) || (key.length > 5 && key.endsWith(':post'));
}
