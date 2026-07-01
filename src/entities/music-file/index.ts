export type Blake3Hash = string;

export interface MusicFile {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  modifiedAt: string;
  extension: string;
  contentHash: Blake3Hash | null;
}

export type DiffStatus = "New" | "Orphan" | "Identical" | "Different";

export type ComparisonLevel = "Fast" | "Metadata" | "Strict";

export type CopyStatus =
  | "Pending"
  | "InProgress"
  | "Verifying"
  | "Done"
  | { Failed: string }
  | "Skipped";

export interface ComparisonStats {
  totalNew: number;
  totalOrphan: number;
  totalIdentical: number;
  totalDifferent: number;
  totalSizeNew: number;
  totalSizeDifferent: number;
}

export interface ComparisonEntry {
  relativePath: string;
  status: DiffStatus;
  source: MusicFile | null;
  destination: MusicFile | null;
  selected: boolean;
}

export interface ComparisonResult {
  entries: ComparisonEntry[];
  scannedAt: string;
  sourceRoot: string;
  destinationRoot: string;
  comparisonLevel: ComparisonLevel;
  stats: ComparisonStats;
}

export interface CopyTask {
  entry: ComparisonEntry;
  status: CopyStatus;
  bytesCopied: number;
  retries: number;
}
