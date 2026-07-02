import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./useAppStore";

// ---------------------------------------------------------------------------
// useAppStore — state management tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  useAppStore.setState({ selectedPaths: [], spaceInfo: null, spaceLoading: false });
});

describe("useAppStore — toggleSelect", () => {
  it("adds a path when not already selected", () => {
    useAppStore.getState().toggleSelect("a.flac");
    expect(useAppStore.getState().selectedPaths).toEqual(["a.flac"]);
  });

  it("removes a path when already selected", () => {
    useAppStore.setState({ selectedPaths: ["a.flac", "b.flac"] });
    useAppStore.getState().toggleSelect("a.flac");
    expect(useAppStore.getState().selectedPaths).toEqual(["b.flac"]);
  });

  it("toggles the same path repeatedly", () => {
    useAppStore.getState().toggleSelect("x.flac");
    expect(useAppStore.getState().selectedPaths).toEqual(["x.flac"]);
    useAppStore.getState().toggleSelect("x.flac");
    expect(useAppStore.getState().selectedPaths).toEqual([]);
    useAppStore.getState().toggleSelect("x.flac");
    expect(useAppStore.getState().selectedPaths).toEqual(["x.flac"]);
  });

  it("does not affect other paths when toggling", () => {
    useAppStore.setState({ selectedPaths: ["a.flac", "b.flac", "c.flac"] });
    useAppStore.getState().toggleSelect("b.flac");
    expect(useAppStore.getState().selectedPaths).toEqual(["a.flac", "c.flac"]);
  });
});

describe("useAppStore — selectOnly", () => {
  it("replaces selection with given paths", () => {
    useAppStore.setState({ selectedPaths: ["a.flac", "b.flac"] });
    useAppStore.getState().selectOnly(["c.flac", "d.flac"]);
    expect(useAppStore.getState().selectedPaths).toEqual(["c.flac", "d.flac"]);
  });

  it("sets empty array when called with empty", () => {
    useAppStore.setState({ selectedPaths: ["a.flac"] });
    useAppStore.getState().selectOnly([]);
    expect(useAppStore.getState().selectedPaths).toEqual([]);
  });
});

// addToSelection removed — was dead code (no callers as of f7ac51e)

describe("useAppStore — deselectAll", () => {
  it("clears selectedPaths", () => {
    useAppStore.setState({ selectedPaths: ["a.flac", "b.flac"] });
    useAppStore.getState().deselectAll();
    expect(useAppStore.getState().selectedPaths).toEqual([]);
  });

  it("resets spaceInfo to null", () => {
    useAppStore.setState({
      selectedPaths: ["a.flac"],
      spaceInfo: { totalSelectedSize: 100, freeSpaceOnDestination: 1000 },
    });
    useAppStore.getState().deselectAll();
    expect(useAppStore.getState().spaceInfo).toBeNull();
  });

  it("is a no-op when already empty", () => {
    useAppStore.getState().deselectAll();
    expect(useAppStore.getState().selectedPaths).toEqual([]);
    expect(useAppStore.getState().spaceInfo).toBeNull();
  });
});

describe("useAppStore — fetchSpaceInfo", () => {
  beforeEach(() => {
    // Reset store includes clearing spaceInfo and spaceLoading
    useAppStore.setState({ selectedPaths: [], spaceInfo: null, spaceLoading: false });
  });

  it("sets spaceLoading true before fetch", async () => {
    // We need to test the loading state is set before the async operation
    // Since invoke is not mockable here (it's imported from @tauri-apps/api/core),
    // we just verify the initial state transitions correctly
    const promise = useAppStore.getState().fetchSpaceInfo("/dst", ["/src/a.flac"]);
    expect(useAppStore.getState().spaceLoading).toBe(true);
    // Let it fail gracefully (no Tauri runtime)
    await expect(promise).resolves.toBeUndefined();
    expect(useAppStore.getState().spaceLoading).toBe(false);
  });

  it("handles invoke failure gracefully", async () => {
    await useAppStore.getState().fetchSpaceInfo("/dst", ["/nonexistent.flac"]);
    // spaceInfo stays null, spaceLoading is false
    expect(useAppStore.getState().spaceInfo).toBeNull();
    expect(useAppStore.getState().spaceLoading).toBe(false);
  });
});

describe("useAppStore — verifyCopy / setVerifyCopy", () => {
  it("verifyCopy defaults to false", () => {
    expect(useAppStore.getState().verifyCopy).toBe(false);
  });

  it("setVerifyCopy sets verifyCopy to true", () => {
    useAppStore.getState().setVerifyCopy(true);
    expect(useAppStore.getState().verifyCopy).toBe(true);
  });

  it("setVerifyCopy sets verifyCopy to false", () => {
    useAppStore.getState().setVerifyCopy(true);
    useAppStore.getState().setVerifyCopy(false);
    expect(useAppStore.getState().verifyCopy).toBe(false);
  });

  it("verifyCopy is independent of other store state", () => {
    useAppStore.getState().setVerifyCopy(true);
    useAppStore.getState().deselectAll();
    expect(useAppStore.getState().verifyCopy).toBe(true);
  });
});

describe("useAppStore — resetCopy", () => {
  beforeEach(() => {
    useAppStore.setState({
      copyProgress: { currentFile: "a.flac", bytesCopied: 500, totalFileSize: 1000, filesCompleted: 3, totalFiles: 5 },
      copyResults: [{ relativePath: "a.flac", status: "Done" }],
      copyRunning: true,
      copyDone: true,
      copyError: "some error",
    });
  });

  it("clears copyProgress", () => {
    useAppStore.getState().resetCopy();
    expect(useAppStore.getState().copyProgress).toBeNull();
  });

  it("clears copyResults", () => {
    useAppStore.getState().resetCopy();
    expect(useAppStore.getState().copyResults).toBeNull();
  });

  it("sets copyRunning to false", () => {
    useAppStore.getState().resetCopy();
    expect(useAppStore.getState().copyRunning).toBe(false);
  });

  it("sets copyDone to false", () => {
    useAppStore.getState().resetCopy();
    expect(useAppStore.getState().copyDone).toBe(false);
  });

  it("clears copyError", () => {
    useAppStore.getState().resetCopy();
    expect(useAppStore.getState().copyError).toBeNull();
  });

  it("is idempotent when called twice", () => {
    useAppStore.getState().resetCopy();
    const afterFirst = { ...useAppStore.getState() };
    useAppStore.getState().resetCopy();
    const afterSecond = { ...useAppStore.getState() };
    expect(afterSecond).toEqual(afterFirst);
  });
});

describe("useAppStore — onCopyProgress", () => {
  it("updates copyProgress in store", () => {
    const progress = { currentFile: "song.flac", bytesCopied: 512, totalFileSize: 1024, filesCompleted: 1, totalFiles: 3 };
    useAppStore.getState().onCopyProgress(progress);
    expect(useAppStore.getState().copyProgress).toEqual(progress);
  });

  it("replaces previous progress", () => {
    const first = { currentFile: "a.flac", bytesCopied: 256, totalFileSize: 1024, filesCompleted: 0, totalFiles: 2 };
    const second = { currentFile: "b.flac", bytesCopied: 1024, totalFileSize: 1024, filesCompleted: 1, totalFiles: 2 };
    useAppStore.getState().onCopyProgress(first);
    useAppStore.getState().onCopyProgress(second);
    expect(useAppStore.getState().copyProgress).toEqual(second);
  });

  it("does not affect other store fields", () => {
    useAppStore.setState({ copyRunning: true });
    const progress = { currentFile: "x.flac", bytesCopied: 0, totalFileSize: 100, filesCompleted: 0, totalFiles: 1 };
    useAppStore.getState().onCopyProgress(progress);
    expect(useAppStore.getState().copyRunning).toBe(true);
    expect(useAppStore.getState().copyDone).toBe(false);
  });
});
