/** Returns the opening marker of a delimited section in a markdown file. */
function openMarker(key: string): string {
  return `<!-- section:${key} -->`;
}

/** Returns the closing marker of a delimited section. */
function closeMarker(key: string): string {
  return `<!-- /section:${key} -->`;
}

/**
 * Replaces or inserts a delimited section in file content.
 *
 * When both markers exist in order, replaces the content between them. Otherwise, prepends the
 * section (with markers) at the top of the content.
 */
export function injectSection(content: string, key: string, injection: string): string {
  const open = openMarker(key);
  const close = closeMarker(key);

  const openIndex = content.indexOf(open);
  const closeIndex = content.indexOf(close);

  if (openIndex !== -1 && closeIndex !== -1 && closeIndex > openIndex) {
    const before = content.slice(0, openIndex + open.length);
    const after = content.slice(closeIndex);
    return `${before}\n${injection}\n${after}`;
  }

  const section = `${open}\n${injection}\n${close}`;
  if (content.length === 0) {
    return `${section}\n`;
  }
  return `${section}\n\n${content}`;
}
