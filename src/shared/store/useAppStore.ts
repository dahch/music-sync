import { create } from "zustand";
import { calculateSizeAndSpace } from "@/shared/api";
import type { SpaceInfo } from "@/shared/api";

interface AppState {
  selectedPaths: string[];
  spaceInfo: SpaceInfo | null;
  spaceLoading: boolean;
  spaceError: string | null;

  toggleSelect: (path: string) => void;
  selectOnly: (paths: string[]) => void;
  deselectAll: () => void;
  fetchSpaceInfo: (destinationRoot: string, selectedAbsolutePaths: string[]) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  selectedPaths: [],
  spaceInfo: null,
  spaceLoading: false,
  spaceError: null,

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
}));
