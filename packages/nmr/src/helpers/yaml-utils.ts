import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

export function readYamlFile(filepath: string): unknown {
  try {
    const content = readFileSync(filepath, 'utf8');
    return parse(content);
  } catch (error) {
    throw new Error(`Failed to read YAML file: ${filepath}\n${error instanceof Error ? error.message : String(error)}`);
  }
}
