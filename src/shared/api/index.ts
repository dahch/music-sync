import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ComparisonResult, SyncHistoryEntry, HistoryPage } from "@/entities/music-file";

export type { ComparisonResult, SyncHistoryEntry, HistoryPage } from "@/entities/music-file";

export interface ScanProgress {
  filesFound: number;
  currentPath: string | null;
}

export interface SpaceInfo {
  totalSelectedSize: number;
  freeSpaceOnDestination: number;
}

export async function scanAndCompare(
  sourcePath: string,
  destPath: string,
  level: string,
): Promise<ComparisonResult> {
  return invoke("scan_and_compare", {
    sourcePath,
    destPath,
    level,
  });
}

export function onScanProgress(
  callback: (progress: ScanProgress) => void,
): Promise<UnlistenFn> {
  return listen<ScanProgress>("scan:progress", (event) => {
    callback(event.payload);
  });
}

export async function calculateSizeAndSpace(
  destinationRoot: string,
  selectedPaths: string[],
): Promise<SpaceInfo> {
  return invoke("calculate_size_and_space", {
    destinationRoot,
    selectedPaths,
  });
}

export async function saveHistoryEntry(
  entry: SyncHistoryEntry,
): Promise<void> {
  return invoke("save_history_entry", { entry });
}

export async function listHistory(
  page: number,
  pageSize: number,
): Promise<HistoryPage> {
  return invoke("list_history", { page, pageSize });
}
