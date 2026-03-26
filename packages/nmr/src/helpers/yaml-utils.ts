import { readFileSync } from 'node:fs';

import yaml from 'js-yaml';

export function readYamlFile(filepath: string): unknown {
  try {
    const content = readFileSync(filepath, 'utf8');
    return yaml.load(content);
  } catch (error) {
    throw new Error(`Failed to read YAML file: ${filepath}\n${error instanceof Error ? error.message : String(error)}`);
  }
}
