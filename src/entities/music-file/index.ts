export type Blake3Hash = string;

export interface MusicFile {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  modifiedAt: number;
  extension: string;
  contentHash: string | null;
}

export type DiffStatus = "New" | "Orphan" | "Identical" | "Different";

export type ComparisonLevel = "Fast" | "Metadata" | "Strict";

export type CopyStatus =
  | "Pending"
  | "InProgress"
  | "Verifying"
  | "Done"
  | { Failed: string }
  | "Skipped"
  | "Cancelled";

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
  scannedAt: number;
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

export interface CopyProgress {
  currentFile: string;
  bytesCopied: number;
  totalFileSize: number;
  filesCompleted: number;
  totalFiles: number;
}

export interface CopyItemResult {
  relativePath: string;
  status: CopyStatus;
}

export interface SyncHistoryEntry {
  id: string;
  profileId: string | null;
  sourceRoot: string;
  destinationRoot: string;
  comparisonLevel: ComparisonLevel;
  filesNew: number;
  filesUpdated: number;
  filesSkipped: number;
  filesFailed: number;
  bytesCopied: number;
  totalBytes: number;
  startedAt: string;
  completedAt: string | null;
  status: string;
  errorMessage: string | null;
}

export interface HistoryPage {
  entries: SyncHistoryEntry[];
  page: number;
  pageSize: number;
  total: number;
}
