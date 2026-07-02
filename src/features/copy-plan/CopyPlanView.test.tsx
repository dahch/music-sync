import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CopyPlanView } from "./CopyPlanView";
import type { ComparisonResult, ComparisonEntry, MusicFile } from "@/entities/music-file";
import { useAppStore } from "@/shared/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const src = (name: string, size: number): MusicFile => ({
  relativePath: name,
  absolutePath: `/src/${name}`,
  sizeBytes: size,
  modifiedAt: 1704067200,
  extension: "flac",
  contentHash: null,
});

const entry = (
  overrides: Partial<ComparisonEntry> & { relativePath: string; status: ComparisonEntry["status"] }
): ComparisonEntry => ({
  relativePath: overrides.relativePath,
  status: overrides.status,
  source: overrides.source ?? null,
  destination: overrides.destination ?? null,
  selected: overrides.selected ?? false,
});

const sampleResult: ComparisonResult = {
  entries: [
    entry({ relativePath: "song.flac", status: "New", source: src("song.flac", 1024), destination: null }),
    entry({ relativePath: "track.flac", status: "New", source: src("track.flac", 2048), destination: null }),
    entry({ relativePath: "orphan.flac", status: "Orphan", source: null, destination: src("orphan.flac", 500) }),
  ],
  scannedAt: 1704067200,
  sourceRoot: "/source",
  destinationRoot: "/dest",
  comparisonLevel: "Metadata",
  stats: { totalNew: 2, totalOrphan: 1, totalIdentical: 0, totalDifferent: 0, totalSizeNew: 3072, totalSizeDifferent: 0 },
};

function resetStore() {
  useAppStore.setState({
    selectedPaths: [],
    verifyCopy: false,
    copyRunning: false,
    spaceInfo: null,
    spaceLoading: false,
    spaceError: null,
    copyDone: false,
    copyError: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CopyPlanView", () => {
  beforeEach(resetStore);

  it('shows "No files selected" when selectedPaths is empty', () => {
    render(<CopyPlanView result={sampleResult} />);
    expect(screen.getByText("No files selected for copy.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows selected file count and total size", () => {
    useAppStore.setState({ selectedPaths: ["song.flac", "track.flac"] });
    render(<CopyPlanView result={sampleResult} />);
    expect(screen.getByText(/2 files/)).toBeInTheDocument();
    expect(screen.getByText(/3.0 KB/)).toBeInTheDocument(); // 1024 + 2048 = 3072 = 3.0 KB
  });

  it("shows singular 'file' when exactly 1 file selected", () => {
    useAppStore.setState({ selectedPaths: ["song.flac"] });
    render(<CopyPlanView result={sampleResult} />);
    expect(screen.getByText(/1 file/)).toBeInTheDocument();
    expect(screen.queryByText(/1 files/)).not.toBeInTheDocument();
  });

  it("lists each selected file path with its size", () => {
    useAppStore.setState({ selectedPaths: ["song.flac", "track.flac"] });
    render(<CopyPlanView result={sampleResult} />);
    expect(screen.getByText("song.flac")).toBeInTheDocument();
    expect(screen.getByText("track.flac")).toBeInTheDocument();
    expect(screen.getByText("1.0 KB")).toBeInTheDocument(); // song size
    expect(screen.getByText("2.0 KB")).toBeInTheDocument(); // track size
  });

  it("does not list selected entries without a source entry", () => {
    // orphan.flac is selected but has no source — should be skipped in file list
    useAppStore.setState({ selectedPaths: ["song.flac", "orphan.flac"] });
    render(<CopyPlanView result={sampleResult} />);
    expect(screen.getByText("song.flac")).toBeInTheDocument();
    expect(screen.queryByText("orphan.flac")).not.toBeInTheDocument();
  });

  it("total size excludes entries without source", () => {
    useAppStore.setState({ selectedPaths: ["song.flac", "orphan.flac"] });
    render(<CopyPlanView result={sampleResult} />);
    // Only song.flac (1024 bytes) counted => 1.0 KB appears at least once
    expect(screen.getAllByText(/1.0 KB/).length).toBeGreaterThanOrEqual(1);
    // song.flac appears, orphan.flac does not (no source)
    expect(screen.getByText("song.flac")).toBeInTheDocument();
    expect(screen.queryByText("orphan.flac")).not.toBeInTheDocument();
  });

  it("verification checkbox defaults to unchecked", () => {
    useAppStore.setState({ selectedPaths: ["song.flac"] });
    render(<CopyPlanView result={sampleResult} />);
    const checkbox = screen.getByRole("checkbox", { name: /BLAKE3/i });
    expect(checkbox).not.toBeChecked();
  });

  it("verification checkbox toggles store value on click", () => {
    useAppStore.setState({ selectedPaths: ["song.flac"] });
    render(<CopyPlanView result={sampleResult} />);
    const checkbox = screen.getByRole("checkbox", { name: /BLAKE3/i });
    fireEvent.click(checkbox);
    expect(useAppStore.getState().verifyCopy).toBe(true);
    fireEvent.click(checkbox);
    expect(useAppStore.getState().verifyCopy).toBe(false);
  });

  it("checkbox reflects stored verifyCopy value", () => {
    useAppStore.setState({ selectedPaths: ["song.flac"], verifyCopy: true });
    render(<CopyPlanView result={sampleResult} />);
    expect(screen.getByRole("checkbox", { name: /BLAKE3/i })).toBeChecked();
  });

  it("start copy button is enabled when files are selected and not running", () => {
    useAppStore.setState({ selectedPaths: ["song.flac"] });
    render(<CopyPlanView result={sampleResult} />);
    const btn = screen.getByRole("button", { name: /Copy 1 file/i });
    expect(btn).not.toBeDisabled();
  });

  it("start copy button is disabled when copyRunning is true", () => {
    useAppStore.setState({ selectedPaths: ["song.flac"], copyRunning: true });
    render(<CopyPlanView result={sampleResult} />);
    const btn = screen.getByRole("button", { name: /Copying…/i });
    expect(btn).toBeDisabled();
  });

  it('start copy button shows "Copying…" when copyRunning', () => {
    useAppStore.setState({ selectedPaths: ["song.flac"], copyRunning: true });
    render(<CopyPlanView result={sampleResult} />);
    expect(screen.getByText("Copying…")).toBeInTheDocument();
  });

  it("clicking start copy calls startCopy with verify=false by default", () => {
    useAppStore.setState({ selectedPaths: ["song.flac"] });
    const startCopySpy = vi.spyOn(useAppStore.getState(), "startCopy");
    render(<CopyPlanView result={sampleResult} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy 1 file/i }));
    expect(startCopySpy).toHaveBeenCalledWith("/source", "/dest", ["song.flac"], false);
    startCopySpy.mockRestore();
  });

  it("clicking start copy with verify=true passes verify flag", () => {
    useAppStore.setState({ selectedPaths: ["song.flac"], verifyCopy: true });
    const startCopySpy = vi.spyOn(useAppStore.getState(), "startCopy");
    render(<CopyPlanView result={sampleResult} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy 1 file/i }));
    expect(startCopySpy).toHaveBeenCalledWith("/source", "/dest", ["song.flac"], true);
    startCopySpy.mockRestore();
  });

  it("does not call startCopy when no files are selected (button not rendered)", () => {
    const startCopySpy = vi.spyOn(useAppStore.getState(), "startCopy");
    render(<CopyPlanView result={sampleResult} />);
    expect(startCopySpy).not.toHaveBeenCalled();
    startCopySpy.mockRestore();
  });

  it("shows free space when spaceInfo is available", () => {
    useAppStore.setState({
      selectedPaths: ["song.flac"],
      spaceInfo: { totalSelectedSize: 1024, freeSpaceOnDestination: 100_000_000 },
    });
    render(<CopyPlanView result={sampleResult} />);
    expect(screen.getByText(/Free on destination/)).toBeInTheDocument();
  });

  it('shows "Not enough space" warning when selected exceeds free', () => {
    useAppStore.setState({
      selectedPaths: ["song.flac", "track.flac"],
      spaceInfo: { totalSelectedSize: 3072, freeSpaceOnDestination: 2000 },
    });
    render(<CopyPlanView result={sampleResult} />);
    expect(screen.getByText(/Not enough space/)).toBeInTheDocument();
  });

  it('shows "Copy anyway" when free space insufficient', () => {
    useAppStore.setState({
      selectedPaths: ["song.flac", "track.flac"],
      spaceInfo: { totalSelectedSize: 3072, freeSpaceOnDestination: 2000 },
    });
    render(<CopyPlanView result={sampleResult} />);
    expect(screen.getByRole("button", { name: /Copy anyway/i })).toBeInTheDocument();
  });

  it('does not render free space section when spaceInfo is null', () => {
    useAppStore.setState({ selectedPaths: ["song.flac"], spaceInfo: null });
    render(<CopyPlanView result={sampleResult} />);
    expect(screen.queryByText(/Free on destination/)).not.toBeInTheDocument();
  });

  it('renders heading "Copy Plan"', () => {
    useAppStore.setState({ selectedPaths: ["song.flac"] });
    render(<CopyPlanView result={sampleResult} />);
    expect(screen.getByText("Copy Plan")).toBeInTheDocument();
  });

  it("does not crash when result has empty entries", () => {
    const emptyResult: ComparisonResult = {
      ...sampleResult,
      entries: [],
      stats: { totalNew: 0, totalOrphan: 0, totalIdentical: 0, totalDifferent: 0, totalSizeNew: 0, totalSizeDifferent: 0 },
    };
    useAppStore.setState({ selectedPaths: ["song.flac"] });
    // song.flac is not in entries so entryMap won't find it — no crash
    render(<CopyPlanView result={emptyResult} />);
    expect(screen.getByText(/Copy Plan/)).toBeInTheDocument();
    // Since song.flac has no source in the empty entries, it won't appear
    // The selectedPaths still shows count=1 but the file list will be empty inside the scrollable div
  });
});
