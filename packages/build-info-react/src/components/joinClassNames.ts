/** Appends a consumer's class names to a component's own class, which always comes first. */
export function joinClassNames(ownClassName: string, extraClassName: string | undefined): string {
  return extraClassName === undefined || extraClassName === '' ? ownClassName : `${ownClassName} ${extraClassName}`;
}
