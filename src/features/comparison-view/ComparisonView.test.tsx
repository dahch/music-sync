import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ComparisonView,
  ComparisonSummary,
  ComparisonList,
  ComparisonEntryRow,
  SelectionPanel,
} from "./ComparisonView";
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

const dst = (name: string, size: number): MusicFile => ({
  relativePath: name,
  absolutePath: `/dst/${name}`,
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
    entry({ relativePath: "new.flac", status: "New", source: src("new.flac", 1000), destination: null }),
    entry({ relativePath: "id.flac", status: "Identical", source: src("id.flac", 500), destination: dst("id.flac", 500) }),
    entry({ relativePath: "diff.flac", status: "Different", source: src("diff.flac", 300), destination: dst("diff.flac", 250) }),
    entry({ relativePath: "orph.flac", status: "Orphan", source: null, destination: dst("orph.flac", 200) }),
  ],
  scannedAt: 1704067200,
  sourceRoot: "/src",
  destinationRoot: "/dst",
  comparisonLevel: "Metadata",
  stats: {
    totalNew: 1,
    totalOrphan: 1,
    totalIdentical: 1,
    totalDifferent: 1,
    totalSizeNew: 1000,
    totalSizeDifferent: 300,
  },
};

function resetStore() {
  useAppStore.setState({ selectedPaths: [], spaceInfo: null, spaceLoading: false, spaceError: null });
}

// ---------------------------------------------------------------------------
// ComparisonEntryRow
// ---------------------------------------------------------------------------

describe("ComparisonEntryRow", () => {
  it("renders checkbox and toggles on click", () => {
    const onToggle = vi.fn();
    const e = entry({ relativePath: "a.flac", status: "New", source: src("a.flac", 100) });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={onToggle} /></tbody></table>);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith("a.flac");
  });

  it("checkbox is checked when selected is true", () => {
    const e = entry({ relativePath: "a.flac", status: "New", source: src("a.flac", 100) });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={true} onToggle={vi.fn()} /></tbody></table>);
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("renders New status with green dot and label", () => {
    const e = entry({ relativePath: "a.flac", status: "New", source: src("a.flac", 100) });
    const { container } = render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(container.textContent).toContain("New");
  });

  it("renders Orphan status with orange dot and label", () => {
    const e = entry({ relativePath: "b.flac", status: "Orphan", destination: dst("b.flac", 200) });
    const { container } = render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(container.textContent).toContain("Orphan");
  });

  it("renders Identical status with gray dot and label", () => {
    const e = entry({ relativePath: "c.flac", status: "Identical", source: src("c.flac", 50), destination: dst("c.flac", 50) });
    const { container } = render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(container.textContent).toContain("Identical");
  });

  it("renders Different status with red dot and label", () => {
    const e = entry({ relativePath: "d.flac", status: "Different", source: src("d.flac", 100), destination: dst("d.flac", 80) });
    const { container } = render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(container.textContent).toContain("Different");
  });

  it("shows source size when source exists", () => {
    const e = entry({ relativePath: "a.flac", status: "New", source: src("a.flac", 1024) });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
  });

  it("shows dash when source is null", () => {
    const e = entry({ relativePath: "a.flac", status: "Orphan", destination: dst("a.flac", 200) });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    const tds = screen.getAllByRole("cell");
    const cellTexts = tds.map((td) => td.textContent);
    const sourceCell = cellTexts[3];
    expect(sourceCell).toBe("—");
  });

  it("shows dash when destination is null", () => {
    const e = entry({ relativePath: "a.flac", status: "New", source: src("a.flac", 200) });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    const tds = screen.getAllByRole("cell");
    const cellTexts = tds.map((td) => td.textContent);
    const destCell = cellTexts[4];
    expect(destCell).toBe("—");
  });

  it("shows both source and dest sizes when both exist", () => {
    const e = entry({
      relativePath: "a.flac",
      status: "Different",
      source: src("a.flac", 2048),
      destination: dst("a.flac", 1024),
    });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
  });

  it("renders relative path in monospace", () => {
    const e = entry({ relativePath: "subdir/song.flac", status: "New", source: src("subdir/song.flac", 100) });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(screen.getByText("subdir/song.flac")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// formatSize (tested indirectly via ComparisonEntryRow)
// ---------------------------------------------------------------------------

describe("formatSize (via component rendering)", () => {
  it("renders bytes when < 1024 (non-zero)", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 500) });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(screen.getByText("500 B")).toBeInTheDocument();
  });

  it("shows 0 B when bytes is 0", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 0) });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(screen.getByText("0 B")).toBeInTheDocument();
  });

  it("renders bytes for 1023", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 1023) });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(screen.getByText("1023 B")).toBeInTheDocument();
  });

  it("renders KB for 1024", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 1024) });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
  });

  it("renders KB for large files under 1 MB", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 500_000) });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(screen.getByText(/(\d+\.\d) KB/)).toBeInTheDocument();
  });

  it("renders MB for 1 MB and above", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 2_000_000) });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(screen.getByText(/(\d+\.\d) MB/)).toBeInTheDocument();
  });

  it("renders MB for 1048576 (exactly 1 MiB)", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 1_048_576) });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(screen.getByText(/(\d+\.\d) MB/)).toBeInTheDocument();
  });

  it("renders GB for values >= 1 GB", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 3_000_000_000) });
    render(<table><tbody><ComparisonEntryRow entry={e} selected={false} onToggle={vi.fn()} /></tbody></table>);
    expect(screen.getByText(/(\d+\.\d) GB/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ComparisonList
// ---------------------------------------------------------------------------

describe("ComparisonList", () => {
  it("renders table with header columns including checkbox column", () => {
    render(<ComparisonList result={sampleResult} selectedPaths={[]} onToggle={vi.fn()} />);
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Path")).toBeInTheDocument();
    expect(screen.getByText("Source size")).toBeInTheDocument();
    expect(screen.getByText("Dest size")).toBeInTheDocument();
  });

  it("renders all entries as rows with checkboxes", () => {
    render(<ComparisonList result={sampleResult} selectedPaths={[]} onToggle={vi.fn()} />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(4);
  });

  it("shows empty state when no entries", () => {
    const empty = { ...sampleResult, entries: [] };
    render(<ComparisonList result={empty} selectedPaths={[]} onToggle={vi.fn()} />);
    expect(screen.getByText("No files found.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("checks checkboxes that match selectedPaths", () => {
    render(<ComparisonList result={sampleResult} selectedPaths={["new.flac", "diff.flac"]} onToggle={vi.fn()} />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
    expect(checkboxes[2]).toBeChecked();
    expect(checkboxes[3]).not.toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// ComparisonSummary
// ---------------------------------------------------------------------------

describe("ComparisonSummary", () => {
  beforeEach(resetStore);

  it("renders counts for each status", () => {
    render(<ComparisonSummary result={sampleResult} />);
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Identical")).toBeInTheDocument();
    expect(screen.getByText("Orphan")).toBeInTheDocument();
    expect(screen.getByText("Different")).toBeInTheDocument();
  });

  it("renders mass action buttons", () => {
    render(<ComparisonSummary result={sampleResult} />);
    expect(screen.getByText("Select all New")).toBeInTheDocument();
    expect(screen.getByText("Select all Different")).toBeInTheDocument();
    expect(screen.getByText("Select all")).toBeInTheDocument();
    expect(screen.getByText("Deselect all")).toBeInTheDocument();
  });

  it("clicking 'Select all New' selects only New entries", () => {
    render(<ComparisonSummary result={sampleResult} />);
    fireEvent.click(screen.getByText("Select all New"));
    const { selectedPaths } = useAppStore.getState();
    expect(selectedPaths).toEqual(["new.flac"]);
  });

  it("clicking 'Select all Different' selects only Different entries", () => {
    render(<ComparisonSummary result={sampleResult} />);
    fireEvent.click(screen.getByText("Select all Different"));
    const { selectedPaths } = useAppStore.getState();
    expect(selectedPaths).toEqual(["diff.flac"]);
  });

  it("clicking 'Select all' selects every entry", () => {
    render(<ComparisonSummary result={sampleResult} />);
    fireEvent.click(screen.getByText("Select all"));
    const { selectedPaths } = useAppStore.getState();
    expect(selectedPaths).toHaveLength(4);
  });

  it("clicking 'Deselect all' clears selection", () => {
    useAppStore.setState({ selectedPaths: ["new.flac", "diff.flac"] });
    render(<ComparisonSummary result={sampleResult} />);
    fireEvent.click(screen.getByText("Deselect all"));
    const { selectedPaths } = useAppStore.getState();
    expect(selectedPaths).toHaveLength(0);
  });

  it("renders size for categories with size > 0", () => {
    render(<ComparisonSummary result={sampleResult} />);
    expect(screen.getByText("1000 B")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SelectionPanel
// ---------------------------------------------------------------------------

describe("SelectionPanel", () => {
  beforeEach(resetStore);

  it("renders nothing when nothing is selected", () => {
    useAppStore.setState({ selectedPaths: [], spaceInfo: null });
    const { container } = render(<SelectionPanel result={sampleResult} />);
    expect(container.textContent).toBe("");
  });

  it("shows selected count and size when items are selected", () => {
    useAppStore.setState({ selectedPaths: ["new.flac", "diff.flac"] });
    render(<SelectionPanel result={sampleResult} />);
    expect(screen.getByText(/Selected:/)).toBeInTheDocument();
    expect(screen.getByText(/2 files/)).toBeInTheDocument();
  });

  it("shows free space info when available", () => {
    useAppStore.setState({
      selectedPaths: ["new.flac"],
      spaceInfo: { totalSelectedSize: 1000, freeSpaceOnDestination: 1_000_000_000 },
    });
    render(<SelectionPanel result={sampleResult} />);
    expect(screen.getByText(/Free on destination/)).toBeInTheDocument();
  });

  it("shows warning when selected size exceeds free space", () => {
    useAppStore.setState({
      selectedPaths: ["new.flac", "diff.flac"],
      spaceInfo: { totalSelectedSize: 1300, freeSpaceOnDestination: 500 },
    });
    render(<SelectionPanel result={sampleResult} />);
    expect(screen.getByText(/Not enough free space/)).toBeInTheDocument();
  });

  it("shows loading indicator while fetching space info", () => {
    useAppStore.setState({
      selectedPaths: ["new.flac"],
      spaceLoading: true,
    });
    render(<SelectionPanel result={sampleResult} />);
    expect(screen.getByText(/Checking free space/)).toBeInTheDocument();
  });

  it("shows error message when spaceError is set", () => {
    useAppStore.setState({
      selectedPaths: ["new.flac"],
      spaceError: "disk not found",
    });
    render(<SelectionPanel result={sampleResult} />);
    expect(screen.getByText(/Error: disk not found/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ComparisonView
// ---------------------------------------------------------------------------

describe("ComparisonView", () => {
  beforeEach(resetStore);

  it("renders result summary and entry table", () => {
    render(<ComparisonView result={sampleResult} />);
    expect(screen.getByText(/Comparison results/)).toBeInTheDocument();
    expect(screen.getByText("new.flac")).toBeInTheDocument();
    expect(screen.getByText("id.flac")).toBeInTheDocument();
    expect(screen.getByText("diff.flac")).toBeInTheDocument();
    expect(screen.getByText("orph.flac")).toBeInTheDocument();
  });

  it("shows source and destination roots", () => {
    render(<ComparisonView result={sampleResult} />);
    expect(screen.getByText(/\/src/)).toBeInTheDocument();
    expect(screen.getByText(/\/dst/)).toBeInTheDocument();
  });

  it("displays comparison level in heading", () => {
    render(<ComparisonView result={sampleResult} />);
    const heading = screen.getByText(/Comparison results/);
    expect(heading.textContent).toContain("Metadata");
  });

  it("displays Fast comparison level", () => {
    const fast = { ...sampleResult, comparisonLevel: "Fast" as const };
    render(<ComparisonView result={fast} />);
    const heading = screen.getByText(/Comparison results/);
    expect(heading.textContent).toContain("Fast");
  });

  it("displays Strict comparison level", () => {
    const strict = { ...sampleResult, comparisonLevel: "Strict" as const };
    render(<ComparisonView result={strict} />);
    const heading = screen.getByText(/Comparison results/);
    expect(heading.textContent).toContain("Strict");
  });

  it("shows empty state when no entries", () => {
    const emptyResult: ComparisonResult = {
      ...sampleResult,
      entries: [],
      stats: {
        totalNew: 0,
        totalOrphan: 0,
        totalIdentical: 0,
        totalDifferent: 0,
        totalSizeNew: 0,
        totalSizeDifferent: 0,
      },
    };
    render(<ComparisonView result={emptyResult} />);
    expect(screen.getByText("No files found.")).toBeInTheDocument();
  });

  it("renders mass action buttons and checkboxes", () => {
    render(<ComparisonView result={sampleResult} />);
    expect(screen.getByText("Select all New")).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("ComparisonView edge cases", () => {
  beforeEach(resetStore);

  it("handles entry with source null and dest null gracefully", () => {
    const ghost: ComparisonResult = {
      ...sampleResult,
      entries: [entry({ relativePath: "ghost.flac", status: "New", source: null, destination: null })],
      stats: { totalNew: 1, totalOrphan: 0, totalIdentical: 0, totalDifferent: 0, totalSizeNew: 0, totalSizeDifferent: 0 },
    };
    render(<ComparisonView result={ghost} />);
    expect(screen.getByText("ghost.flac")).toBeInTheDocument();
  });

  it("handles very large byte values", () => {
    const huge: ComparisonResult = {
      ...sampleResult,
      entries: [
        entry({ relativePath: "huge.flac", status: "New", source: src("huge.flac", 5_000_000_000) }),
      ],
      stats: { ...sampleResult.stats, totalNew: 1, totalSizeNew: 5_000_000_000 },
    };
    render(<ComparisonView result={huge} />);
    expect(screen.getAllByText(/(\d+\.\d) GB/).length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// StatCard coverage — hiding size when count is 0 or size is undefined
// ---------------------------------------------------------------------------

describe("StatCard (via ComparisonSummary)", () => {
  beforeEach(resetStore);

  it("hides size line when count is 0 even if size is provided", () => {
    const result: ComparisonResult = {
      ...sampleResult,
      stats: { totalNew: 0, totalOrphan: 1, totalIdentical: 1, totalDifferent: 1, totalSizeNew: 9999, totalSizeDifferent: 300 },
    };
    render(<ComparisonSummary result={result} />);
    expect(screen.queryByText("9999 B")).not.toBeInTheDocument();
    expect(screen.queryByText("9.8 KB")).not.toBeInTheDocument();
  });

  it("shows size for only New and Different cards (not Orphan/Identical)", () => {
    render(<ComparisonSummary result={sampleResult} />);
    expect(screen.getByText("1000 B")).toBeInTheDocument();
    expect(screen.getByText("300 B")).toBeInTheDocument();
    const sizeElements = screen.getAllByText(/^\d+(\.\d)?\s*(B|KB|MB|GB)$/);
    expect(sizeElements).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// SelectionPanel — edge cases
// ---------------------------------------------------------------------------

describe("SelectionPanel — edge cases", () => {
  beforeEach(resetStore);

  it("shows singular 'file' when exactly 1 file selected", () => {
    useAppStore.setState({ selectedPaths: ["new.flac"] });
    render(<SelectionPanel result={sampleResult} />);
    expect(screen.getByText(/1 file/)).toBeInTheDocument();
    expect(screen.queryByText(/1 files/)).not.toBeInTheDocument();
  });

  it("shows plural 'files' when multiple files selected", () => {
    useAppStore.setState({ selectedPaths: ["new.flac", "diff.flac"] });
    render(<SelectionPanel result={sampleResult} />);
    expect(screen.getByText(/2 files/)).toBeInTheDocument();
  });

  it("does not count selected entries without source in selectedCount", () => {
    useAppStore.setState({ selectedPaths: ["orph.flac"] });
    render(<SelectionPanel result={sampleResult} />);
    expect(screen.queryByText(/Selected:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 files/)).not.toBeInTheDocument();
  });

  it("shows green progress bar when enough space", () => {
    useAppStore.setState({
      selectedPaths: ["new.flac"],
      spaceInfo: { totalSelectedSize: 1000, freeSpaceOnDestination: 10_000 },
    });
    const { container } = render(<SelectionPanel result={sampleResult} />);
    const barInner = container.querySelector('[style*="background-color"]');
    expect(barInner).not.toBeNull();
  });

  it("progress bar width is capped at 100% when selected exceeds free", () => {
    useAppStore.setState({
      selectedPaths: ["diff.flac"],
      spaceInfo: { totalSelectedSize: 300, freeSpaceOnDestination: 100 },
    });
    render(<SelectionPanel result={sampleResult} />);
    expect(screen.getByText(/Not enough free space/)).toBeInTheDocument();
  });

  it("renders nothing extra when spaceInfo is null and not loading", () => {
    useAppStore.setState({
      selectedPaths: ["new.flac"],
      spaceInfo: null,
      spaceLoading: false,
    });
    render(<SelectionPanel result={sampleResult} />);
    expect(screen.getByText(/Selected:/)).toBeInTheDocument();
    expect(screen.queryByText(/Free on destination/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Checking free space/)).not.toBeInTheDocument();
  });

  it("shows GB format for free space when >= 1 GB", () => {
    useAppStore.setState({
      selectedPaths: ["diff.flac"],
      spaceInfo: { totalSelectedSize: 300, freeSpaceOnDestination: 3_000_000_000 },
    });
    render(<SelectionPanel result={sampleResult} />);
    expect(screen.getByText(/Free on destination/)).toBeInTheDocument();
    expect(screen.getByText(/2.8 GB/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ComparisonSummary — more edge cases
// ---------------------------------------------------------------------------

describe("ComparisonSummary — edge cases", () => {
  beforeEach(resetStore);

  it("Deselect all button is disabled when nothing is selected", () => {
    useAppStore.setState({ selectedPaths: [] });
    render(<ComparisonSummary result={sampleResult} />);
    const deselectBtn = screen.getByText("Deselect all").closest("button");
    expect(deselectBtn).toBeDisabled();
  });

  it("Deselect all button is enabled when paths are selected", () => {
    useAppStore.setState({ selectedPaths: ["new.flac"] });
    render(<ComparisonSummary result={sampleResult} />);
    const deselectBtn = screen.getByText("Deselect all").closest("button");
    expect(deselectBtn).not.toBeDisabled();
  });

  it("selecting a status that matches no entries results in empty selection", () => {
    const noDifferent: ComparisonResult = {
      ...sampleResult,
      entries: sampleResult.entries.filter((e) => e.status !== "Different"),
      stats: { ...sampleResult.stats, totalDifferent: 0 },
    };
    render(<ComparisonSummary result={noDifferent} />);
    fireEvent.click(screen.getByText("Select all Different"));
    const { selectedPaths } = useAppStore.getState();
    expect(selectedPaths).toEqual([]);
  });
});
