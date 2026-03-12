import { readFileSync, writeFileSync } from 'node:fs';

import yaml from 'js-yaml';

export function readYamlFile(filepath: string): unknown {
  try {
    const content = readFileSync(filepath, 'utf8');
    return yaml.load(content);
  } catch (error) {
    throw new Error(`Failed to read YAML file: ${filepath}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

export function writeYamlFile(filepath: string, data: unknown): void {
  try {
    const content = yaml.dump(data, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });
    writeFileSync(filepath, content, 'utf8');
  } catch (error) {
    throw new Error(
      `Failed to write YAML file: ${filepath}\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
