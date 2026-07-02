import { create } from "zustand";
import { calculateSizeAndSpace, copyFiles, saveHistoryEntry } from "@/shared/api";
import type { SpaceInfo, CopyProgress, CopyItemResult, SyncHistoryEntry } from "@/shared/api";

interface AppState {
  selectedPaths: string[];
  spaceInfo: SpaceInfo | null;
  spaceLoading: boolean;
  spaceError: string | null;

  copyProgress: CopyProgress | null;
  copyResults: CopyItemResult[] | null;
  copyRunning: boolean;
  copyDone: boolean;
  copyError: string | null;

  toggleSelect: (path: string) => void;
  selectOnly: (paths: string[]) => void;
  deselectAll: () => void;
  fetchSpaceInfo: (destinationRoot: string, selectedAbsolutePaths: string[]) => Promise<void>;
  startCopy: (sourceRoot: string, destinationRoot: string, relativePaths: string[]) => Promise<void>;
  onCopyProgress: (progress: CopyProgress) => void;
  resetCopy: () => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function countFailed(results: CopyItemResult[]): number {
  return results.filter((r) => {
    if (r.status === "Done") return false;
    if (r.status === "Skipped") return false;
    return true;
  }).length;
}

export const useAppStore = create<AppState>((set, get) => ({
  selectedPaths: [],
  spaceInfo: null,
  spaceLoading: false,
  spaceError: null,

  copyProgress: null,
  copyResults: null,
  copyRunning: false,
  copyDone: false,
  copyError: null,

  toggleSelect: (path: string) => {
    const { selectedPaths } = get();
    if (selectedPaths.includes(path)) {
      set({ selectedPaths: selectedPaths.filter((p) => p !== path) });
    } else {
      set({ selectedPaths: [...selectedPaths, path] });
    }
  },

  selectOnly: (paths: string[]) => {
    set({ selectedPaths: paths });
  },

  deselectAll: () => {
    set({ selectedPaths: [], spaceInfo: null, spaceError: null });
  },

  fetchSpaceInfo: async (destinationRoot: string, selectedAbsolutePaths: string[]) => {
    set({ spaceLoading: true, spaceError: null });
    try {
      const info = await calculateSizeAndSpace(destinationRoot, selectedAbsolutePaths);
      set({ spaceInfo: info, spaceLoading: false });
    } catch (err) {
      set({ spaceLoading: false, spaceError: String(err) });
    }
  },

  startCopy: async (sourceRoot: string, destinationRoot: string, relativePaths: string[]) => {
    set({ copyRunning: true, copyDone: false, copyProgress: null, copyResults: null, copyError: null });

    try {
      const items = relativePaths.map((p) => ({ relativePath: p }));
      const results = await copyFiles(sourceRoot, destinationRoot, items);

      const filesNew = results.filter((r) => r.status === "Done").length;
      const filesFailed = countFailed(results);
      const space = get().spaceInfo;
      const totalBytes = space ? space.totalSelectedSize : 0;

      const historyEntry: SyncHistoryEntry = {
        id: generateId(),
        profileId: null,
        sourceRoot,
        destinationRoot,
        comparisonLevel: "Metadata",
        filesNew,
        filesUpdated: 0,
        filesSkipped: 0,
        filesFailed,
        bytesCopied: totalBytes,
        totalBytes,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: filesFailed > 0 ? "CompletedWithErrors" : "Completed",
        errorMessage: null,
      };

      try {
        await saveHistoryEntry(historyEntry);
      } catch {
        // history save is best-effort
      }

      set({ copyResults: results, copyRunning: false, copyDone: true });
    } catch (err) {
      set({ copyRunning: false, copyError: String(err) });
    }
  },

  onCopyProgress: (progress: CopyProgress) => {
    set({ copyProgress: progress });
  },

  resetCopy: () => {
    set({ copyProgress: null, copyResults: null, copyRunning: false, copyDone: false, copyError: null });
  },
}));
