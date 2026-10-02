/** A single GitHub label definition, as `sync-labels generate` writes it to `.github/labels.yaml`. */
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
