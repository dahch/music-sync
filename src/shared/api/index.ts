import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ComparisonResult } from "@/entities/music-file";

export type { ComparisonResult } from "@/entities/music-file";

export interface ScanProgress {
  filesFound: number;
  currentPath: string | null;
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
