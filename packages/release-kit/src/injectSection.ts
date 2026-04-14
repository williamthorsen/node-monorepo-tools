/** Marker format for section delimiters in markdown files. */
function openMarker(key: string): string {
  return `<!-- section:${key} -->`;
}

/** Closing marker for a section delimiter. */
function closeMarker(key: string): string {
  return `<!-- /section:${key} -->`;
}

/**
 * Replace or insert a delimited section in file content.
 *
 * When markers exist, replaces the content between them. When absent, prepends the section
 * (with markers) at the top of the content. The function is pure — no file I/O.
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
