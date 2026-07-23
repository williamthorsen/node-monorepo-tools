/** A single GitHub label definition compatible with EndBug/label-sync. */
export interface LabelDefinition {
  /** Display name of the label. */
  name: string;
  /** Hex color code without the leading `#`. */
  color: string;
  /** Short description shown in the GitHub UI. */
  description: string;
}
