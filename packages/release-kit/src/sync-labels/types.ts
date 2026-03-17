/** A single GitHub label definition compatible with EndBug/label-sync. */
export interface LabelDefinition {
  /** Display name of the label. */
  name: string;
  /** Hex color code without the leading `#`. */
  color: string;
  /** Short description shown in the GitHub UI. */
  description: string;
}

/** Consumer-facing config shape for `.config/sync-labels.config.ts`. */
export interface SyncLabelsConfig {
  /** Preset names to include (e.g., `['common']`). Resolved from bundled preset files. */
  presets?: string[];
  /** Custom label definitions merged with preset labels. */
  labels?: LabelDefinition[];
}
