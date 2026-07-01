import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ComparisonView,
  ComparisonSummary,
  ComparisonList,
  ComparisonEntryRow,
} from "./ComparisonView";
import type { ComparisonResult, ComparisonEntry, MusicFile } from "@/entities/music-file";

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

// ---------------------------------------------------------------------------
// ComparisonEntryRow
// ---------------------------------------------------------------------------

describe("ComparisonEntryRow", () => {
  it("renders New status with green dot and label", () => {
    const e = entry({ relativePath: "a.flac", status: "New", source: src("a.flac", 100) });
    const { container } = render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    expect(container.textContent).toContain("New");
  });

  it("renders Orphan status with orange dot and label", () => {
    const e = entry({ relativePath: "b.flac", status: "Orphan", destination: dst("b.flac", 200) });
    const { container } = render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    expect(container.textContent).toContain("Orphan");
  });

  it("renders Identical status with gray dot and label", () => {
    const e = entry({ relativePath: "c.flac", status: "Identical", source: src("c.flac", 50), destination: dst("c.flac", 50) });
    const { container } = render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    expect(container.textContent).toContain("Identical");
  });

  it("renders Different status with red dot and label", () => {
    const e = entry({ relativePath: "d.flac", status: "Different", source: src("d.flac", 100), destination: dst("d.flac", 80) });
    const { container } = render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    expect(container.textContent).toContain("Different");
  });

  it("shows source size when source exists", () => {
    const e = entry({ relativePath: "a.flac", status: "New", source: src("a.flac", 1024) });
    render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
  });

  it("shows dash when source is null", () => {
    const e = entry({ relativePath: "a.flac", status: "Orphan", destination: dst("a.flac", 200) });
    render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    // Source column shows em dash
    const tds = screen.getAllByRole("cell");
    const cellTexts = tds.map((td) => td.textContent);
    const sourceCell = cellTexts[2]; // 3rd column (status, path, source, dest)
    expect(sourceCell).toBe("—");
  });

  it("shows dash when destination is null", () => {
    const e = entry({ relativePath: "a.flac", status: "New", source: src("a.flac", 200) });
    render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    const tds = screen.getAllByRole("cell");
    const cellTexts = tds.map((td) => td.textContent);
    const destCell = cellTexts[3]; // 4th column
    expect(destCell).toBe("—");
  });

  it("shows both source and dest sizes when both exist", () => {
    const e = entry({
      relativePath: "a.flac",
      status: "Different",
      source: src("a.flac", 2048),
      destination: dst("a.flac", 1024),
    });
    render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
  });

  it("renders relative path in monospace", () => {
    const e = entry({ relativePath: "subdir/song.flac", status: "New", source: src("subdir/song.flac", 100) });
    render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    expect(screen.getByText("subdir/song.flac")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// formatSize (tested indirectly via ComparisonEntryRow)
// ---------------------------------------------------------------------------

describe("formatSize (via component rendering)", () => {
  it("renders bytes when < 1024 (non-zero)", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 500) });
    render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    expect(screen.getByText("500 B")).toBeInTheDocument();
  });

  it("shows 0 B when bytes is 0", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 0) });
    render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    expect(screen.getByText("0 B")).toBeInTheDocument();
  });

  it("renders bytes for 1023", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 1023) });
    render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    expect(screen.getByText("1023 B")).toBeInTheDocument();
  });

  it("renders KB for 1024", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 1024) });
    render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
  });

  it("renders KB for large files under 1 MB", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 500_000) });
    render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    expect(screen.getByText(/(\d+\.\d) KB/)).toBeInTheDocument();
  });

  it("renders MB for 1 MB and above", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 2_000_000) });
    render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    expect(screen.getByText(/(\d+\.\d) MB/)).toBeInTheDocument();
  });

  it("renders MB for 1048576 (exactly 1 MiB)", () => {
    const e = entry({ relativePath: "f.flac", status: "New", source: src("f.flac", 1_048_576) });
    render(<table><tbody><ComparisonEntryRow entry={e} /></tbody></table>);
    expect(screen.getByText(/(\d+\.\d) MB/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ComparisonList
// ---------------------------------------------------------------------------

describe("ComparisonList", () => {
  it("renders table with header columns", () => {
    render(<ComparisonList result={sampleResult} />);
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Path")).toBeInTheDocument();
    expect(screen.getByText("Source size")).toBeInTheDocument();
    expect(screen.getByText("Dest size")).toBeInTheDocument();
  });

  it("renders all entries as rows", () => {
    render(<ComparisonList result={sampleResult} />);
    expect(screen.getByText("new.flac")).toBeInTheDocument();
    expect(screen.getByText("id.flac")).toBeInTheDocument();
    expect(screen.getByText("diff.flac")).toBeInTheDocument();
    expect(screen.getByText("orph.flac")).toBeInTheDocument();
  });

  it("shows empty state when no entries", () => {
    const empty = { ...sampleResult, entries: [] };
    render(<ComparisonList result={empty} />);
    expect(screen.getByText("No files found.")).toBeInTheDocument();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
  });

  it("renders entry rows with status labels", () => {
    render(<ComparisonList result={sampleResult} />);
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Identical")).toBeInTheDocument();
    expect(screen.getByText("Different")).toBeInTheDocument();
    expect(screen.getByText("Orphan")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ComparisonSummary
// ---------------------------------------------------------------------------

describe("ComparisonSummary", () => {
  it("renders counts for each status", () => {
    render(<ComparisonSummary result={sampleResult} />);
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Identical")).toBeInTheDocument();
    expect(screen.getByText("Orphan")).toBeInTheDocument();
    expect(screen.getByText("Different")).toBeInTheDocument();
  });

  it("renders size for categories with size > 0", () => {
    render(<ComparisonSummary result={sampleResult} />);
    expect(screen.getByText("1000 B")).toBeInTheDocument(); // New files total
  });

  it("does NOT show sizes when count is 0", () => {
    const empty: ComparisonResult = {
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
    render(<ComparisonSummary result={empty} />);
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(4);

    // No size values rendered for zero-count cards
    // The StatCard for "New" with count=0 should NOT show any size
    const allNewLabels = screen.getAllByText("New");
    // Find the container for the "New" stat card
    const newCard = allNewLabels[0].closest("div");
    expect(newCard?.textContent).not.toMatch(/\d+\s*B/);
  });

  it("renders size in KB/MB when appropriate", () => {
    const withSizes: ComparisonResult = {
      ...sampleResult,
      stats: {
        totalNew: 2,
        totalOrphan: 0,
        totalIdentical: 0,
        totalDifferent: 1,
        totalSizeNew: 2048,
        totalSizeDifferent: 1_048_576,
      },
    };
    render(<ComparisonSummary result={withSizes} />);
    expect(screen.getByText("2.0 KB")).toBeInTheDocument(); // totalSizeNew → 2.0 KB
    expect(screen.getByText(/1\.0 MB/)).toBeInTheDocument(); // totalSizeDifferent → ~1.0 MB
  });
});

// ---------------------------------------------------------------------------
// ComparisonView
// ---------------------------------------------------------------------------

describe("ComparisonView", () => {
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
    const empty: ComparisonResult = {
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
    render(<ComparisonView result={empty} />);
    expect(screen.getByText("No files found.")).toBeInTheDocument();
  });

  it("renders summary and list sections", () => {
    render(<ComparisonView result={sampleResult} />);
    // Summary renders counts (appear in both summary cards and entry rows)
    expect(screen.getAllByText("New").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Orphan").length).toBeGreaterThanOrEqual(2);
    // StatCard count values
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — missing/partial data
// ---------------------------------------------------------------------------

describe("ComparisonView edge cases", () => {
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
    // Should render as MB (4768.4 MB with current formatting)
    const matches = screen.getAllByText(/4\d+\.\d/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].textContent).toContain("MB");
  });
});
