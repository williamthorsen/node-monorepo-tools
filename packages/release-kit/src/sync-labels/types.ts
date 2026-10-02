/** A single GitHub label definition compatible with EndBug/label-sync. */
export interface LabelDefinition {
  /** Display name of the label. */
  name: string;
  /** Hex color code without the leading `#`. */
  color: string;
  /** Short description shown in the GitHub UI. Absent when the label has none. */
  description?: string;
  /** Marks the label for the sync to archive rather than keep active. Absent for an active label. */
  archived?: true;
}
