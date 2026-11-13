export type DiffLineType = "added" | "removed" | "context";
export interface DiffLine {
  type: DiffLineType;
  text: string;
}
