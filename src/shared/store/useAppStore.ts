import { create } from "zustand";
import { calculateSizeAndSpace, copyFiles, saveHistoryEntry, pauseCopy, resumeCopy, cancelCopy } from "@/shared/api";
import type { SpaceInfo, CopyProgress, CopyItemResult, SyncHistoryEntry } from "@/shared/api";

interface AppState {
  selectedPaths: string[];
  spaceInfo: SpaceInfo | null;
  spaceLoading: boolean;
  spaceError: string | null;

  copyProgress: CopyProgress | null;
  copyResults: CopyItemResult[] | null;
  copyRunning: boolean;
  copyPaused: boolean;
  copyDone: boolean;
  copyError: string | null;
  verifyCopy: boolean;

  toggleSelect: (path: string) => void;
  selectOnly: (paths: string[]) => void;
  deselectAll: () => void;
  fetchSpaceInfo: (destinationRoot: string, selectedAbsolutePaths: string[]) => Promise<void>;
  startCopy: (sourceRoot: string, destinationRoot: string, relativePaths: string[], verify: boolean) => Promise<void>;
  onCopyProgress: (progress: CopyProgress) => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  resetCopy: () => void;
  setVerifyCopy: (v: boolean) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function countFailed(results: CopyItemResult[]): number {
  return results.filter((r) => {
    if (r.status === "Done") return false;
    if (r.status === "Skipped") return false;
    if (r.status === "Cancelled") return false;
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
  copyPaused: false,
  copyDone: false,
  copyError: null,
  verifyCopy: false,

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

  startCopy: async (sourceRoot: string, destinationRoot: string, relativePaths: string[], verify: boolean) => {
    set({ copyRunning: true, copyPaused: false, copyDone: false, copyProgress: null, copyResults: null, copyError: null });

    try {
      const items = relativePaths.map((p) => ({ relativePath: p, verify }));
      const results = await copyFiles(sourceRoot, destinationRoot, items);

      const filesNew = results.filter((r) => r.status === "Done").length;
      const filesFailed = countFailed(results);
      const filesCancelled = results.filter((r) => r.status === "Cancelled").length;
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
        status: filesFailed > 0 ? "CompletedWithErrors" : filesCancelled > 0 ? "Cancelled" : "Completed",
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

  pause: async () => {
    try {
      await pauseCopy();
      set({ copyPaused: true });
    } catch {
      // ignore — pause is best-effort
    }
  },

  resume: async () => {
    try {
      await resumeCopy();
      set({ copyPaused: false });
    } catch {
      // ignore
    }
  },

  cancel: async () => {
    try {
      await cancelCopy();
      set({ copyPaused: false });
    } catch {
      // ignore
    }
  },

  resetCopy: () => {
    set({ copyProgress: null, copyResults: null, copyRunning: false, copyPaused: false, copyDone: false, copyError: null });
  },

  setVerifyCopy: (v: boolean) => {
    set({ verifyCopy: v });
  },
}));
