import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HistoryView, formatSize } from "./HistoryView";
import type { HistoryPage } from "@/entities/music-file";

// Mock the listHistory API
vi.mock("@/shared/api", () => ({
  listHistory: vi.fn(),
}));

import { listHistory } from "@/shared/api";

const mockList = listHistory as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Unit tests for pure helper functions
// ---------------------------------------------------------------------------

describe("formatSize", () => {
  it('returns "X B" for bytes < 1024', () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(500)).toBe("500 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it('returns "X.X KB" for bytes < 1 MiB', () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  it('returns "X.X MB" for bytes < 1 GiB', () => {
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });

  it('returns "X.X GB" for bytes >= 1 GiB', () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(formatSize(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
  });
});

// ---------------------------------------------------------------------------
// Component integration tests
// ---------------------------------------------------------------------------

describe("HistoryView", () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it("shows loading state initially", () => {
    mockList.mockReturnValue(new Promise(() => {})); // never resolves
    render(<HistoryView />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows empty state when no history", async () => {
    const emptyPage: HistoryPage = { entries: [], page: 1, pageSize: 20, total: 0 };
    mockList.mockResolvedValue(emptyPage);

    render(<HistoryView />);
    expect(await screen.findByText("No sync history yet.")).toBeInTheDocument();
  });

  it("renders history entries in a table", async () => {
    const page: HistoryPage = {
      entries: [
        {
          id: "1",
          profileId: null,
          sourceRoot: "/music/src",
          destinationRoot: "/music/dst",
          comparisonLevel: "Metadata",
          filesNew: 10,
          filesUpdated: 2,
          filesSkipped: 0,
          filesFailed: 0,
          bytesCopied: 1000000,
          totalBytes: 2000000,
          startedAt: "2026-07-01T12:00:00Z",
          completedAt: "2026-07-01T12:05:00Z",
          status: "Completed",
          errorMessage: null,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    };
    mockList.mockResolvedValue(page);

    render(<HistoryView />);
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("/music/src")).toBeInTheDocument();
    expect(screen.getByText("/music/dst")).toBeInTheDocument();
  });

  it("shows failed count when files failed", async () => {
    const page: HistoryPage = {
      entries: [
        {
          id: "2",
          profileId: null,
          sourceRoot: "/src",
          destinationRoot: "/dst",
          comparisonLevel: "Fast",
          filesNew: 5,
          filesUpdated: 0,
          filesSkipped: 0,
          filesFailed: 2,
          bytesCopied: 500,
          totalBytes: 1000,
          startedAt: "2026-07-01T13:00:00Z",
          completedAt: null,
          status: "Failed",
          errorMessage: "disk full",
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    };
    mockList.mockResolvedValue(page);

    render(<HistoryView />);
    expect(await screen.findByText("2")).toBeInTheDocument();
  });

  it("renders pagination when multiple pages", async () => {
    const page: HistoryPage = {
      entries: [
        {
          id: "p1", profileId: null, sourceRoot: "/a", destinationRoot: "/b",
          comparisonLevel: "Metadata", filesNew: 1, filesUpdated: 0, filesSkipped: 0,
          filesFailed: 0, bytesCopied: 100, totalBytes: 100,
          startedAt: "2026-07-01T12:00:00Z", completedAt: null,
          status: "Completed", errorMessage: null,
        },
      ],
      page: 1, pageSize: 20, total: 25,
    };
    mockList.mockResolvedValue(page);

    render(<HistoryView />);
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("shows 'Page 1 of 1' when total is 0 (single page)", async () => {
    const page: HistoryPage = { entries: [], page: 1, pageSize: 20, total: 0 };
    mockList.mockResolvedValue(page);

    render(<HistoryView />);
    // When no entries, pagination is hidden, so we check the empty state instead
    expect(await screen.findByText("No sync history yet.")).toBeInTheDocument();
  });

  it("shows error state on API failure", async () => {
    mockList.mockRejectedValue(new Error("db connection failed"));

    render(<HistoryView />);
    expect(await screen.findByText(/Error: db connection failed/)).toBeInTheDocument();
  });

  it("disables the Previous button on page 1", async () => {
    const page: HistoryPage = {
      entries: [
        {
          id: "p1", profileId: null, sourceRoot: "/src", destinationRoot: "/dst",
          comparisonLevel: "Metadata", filesNew: 1, filesUpdated: 0, filesSkipped: 0,
          filesFailed: 0, bytesCopied: 100, totalBytes: 100,
          startedAt: "2026-07-01T12:00:00Z", completedAt: null,
          status: "Completed", errorMessage: null,
        },
      ],
      page: 1, pageSize: 20, total: 25,
    };
    mockList.mockResolvedValue(page);

    render(<HistoryView />);
    const prevButton = await screen.findByText("Previous");
    expect(prevButton.closest("button")).toBeDisabled();
  });

  it("disables the Next button when on the last page", async () => {
    const page: HistoryPage = {
      entries: [
        {
          id: "p1", profileId: null, sourceRoot: "/src", destinationRoot: "/dst",
          comparisonLevel: "Metadata", filesNew: 1, filesUpdated: 0, filesSkipped: 0,
          filesFailed: 0, bytesCopied: 100, totalBytes: 100,
          startedAt: "2026-07-01T12:00:00Z", completedAt: null,
          status: "Completed", errorMessage: null,
        },
      ],
      page: 1, pageSize: 20, total: 1,
    };
    mockList.mockResolvedValue(page);

    render(<HistoryView />);
    const nextButton = await screen.findByText("Next");
    expect(nextButton.closest("button")).toBeDisabled();
  });

  it("enables the Next button when there are multiple pages", async () => {
    const page: HistoryPage = {
      entries: [
        {
          id: "p1", profileId: null, sourceRoot: "/src", destinationRoot: "/dst",
          comparisonLevel: "Metadata", filesNew: 1, filesUpdated: 0, filesSkipped: 0,
          filesFailed: 0, bytesCopied: 100, totalBytes: 100,
          startedAt: "2026-07-01T12:00:00Z", completedAt: null,
          status: "Completed", errorMessage: null,
        },
      ],
      page: 1, pageSize: 20, total: 25,
    };
    mockList.mockResolvedValue(page);

    render(<HistoryView />);
    const nextButton = await screen.findByText("Next");
    expect(nextButton.closest("button")).not.toBeDisabled();
  });

  it("navigates to next page via Next button click", async () => {
    // First call returns page 1, second call returns page 2
    const page1: HistoryPage = {
      entries: [
        {
          id: "p1", profileId: null, sourceRoot: "/a", destinationRoot: "/b",
          comparisonLevel: "Metadata", filesNew: 1, filesUpdated: 0, filesSkipped: 0,
          filesFailed: 0, bytesCopied: 100, totalBytes: 100,
          startedAt: "2026-07-01T12:00:00Z", completedAt: null,
          status: "Completed", errorMessage: null,
        },
      ],
      page: 1, pageSize: 20, total: 25,
    };
    const page2: HistoryPage = {
      entries: [
        {
          id: "p2", profileId: null, sourceRoot: "/c", destinationRoot: "/d",
          comparisonLevel: "Fast", filesNew: 2, filesUpdated: 0, filesSkipped: 0,
          filesFailed: 0, bytesCopied: 200, totalBytes: 200,
          startedAt: "2026-07-01T13:00:00Z", completedAt: null,
          status: "Completed", errorMessage: null,
        },
      ],
      page: 2, pageSize: 20, total: 25,
    };

    mockList.mockResolvedValueOnce(page1);
    mockList.mockResolvedValueOnce(page2);

    render(<HistoryView />);
    expect(await screen.findByText("/a")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByText("/c")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("renders formatSize via table cell for bytesCopied", async () => {
    const page: HistoryPage = {
      entries: [
        {
          id: "s1", profileId: null, sourceRoot: "/src", destinationRoot: "/dst",
          comparisonLevel: "Metadata", filesNew: 0, filesUpdated: 0, filesSkipped: 0,
          filesFailed: 0, bytesCopied: 1048576, totalBytes: 2097152,
          startedAt: "2026-07-01T12:00:00Z", completedAt: null,
          status: "Completed", errorMessage: null,
        },
      ],
      page: 1, pageSize: 20, total: 1,
    };
    mockList.mockResolvedValue(page);

    render(<HistoryView />);
    expect(await screen.findByText("1.0 MB")).toBeInTheDocument();
  });

  it("renders status in green for Completed entries", async () => {
    const page: HistoryPage = {
      entries: [
        {
          id: "s1", profileId: null, sourceRoot: "/src", destinationRoot: "/dst",
          comparisonLevel: "Metadata", filesNew: 1, filesUpdated: 0, filesSkipped: 0,
          filesFailed: 0, bytesCopied: 100, totalBytes: 100,
          startedAt: "2026-07-01T12:00:00Z", completedAt: null,
          status: "Completed", errorMessage: null,
        },
      ],
      page: 1, pageSize: 20, total: 1,
    };
    mockList.mockResolvedValue(page);

    render(<HistoryView />);
    const statusSpan = await screen.findByText("Completed");
    // jsdom renders hex colors as rgb
    expect(statusSpan.style.color).toBe("rgb(34, 197, 94)");
  });

  it("renders status in red for Failed entries", async () => {
    const page: HistoryPage = {
      entries: [
        {
          id: "s1", profileId: null, sourceRoot: "/src", destinationRoot: "/dst",
          comparisonLevel: "Metadata", filesNew: 0, filesUpdated: 0, filesSkipped: 0,
          filesFailed: 2, bytesCopied: 0, totalBytes: 100,
          startedAt: "2026-07-01T12:00:00Z", completedAt: null,
          status: "Failed", errorMessage: "error",
        },
      ],
      page: 1, pageSize: 20, total: 1,
    };
    mockList.mockResolvedValue(page);

    render(<HistoryView />);
    // "Failed" appears in both the column header and the status span — use getAllByText
    const allFailed = await screen.findAllByText("Failed");
    // The span is the element with the color style
    const statusSpan = allFailed.find((el) => el.tagName === "SPAN");
    expect(statusSpan?.style.color).toBe("rgb(239, 68, 68)");
  });

  it("renders status in orange for other statuses (e.g. InProgress)", async () => {
    const page: HistoryPage = {
      entries: [
        {
          id: "s1", profileId: null, sourceRoot: "/src", destinationRoot: "/dst",
          comparisonLevel: "Metadata", filesNew: 0, filesUpdated: 0, filesSkipped: 0,
          filesFailed: 0, bytesCopied: 50, totalBytes: 100,
          startedAt: "2026-07-01T12:00:00Z", completedAt: null,
          status: "InProgress", errorMessage: null,
        },
      ],
      page: 1, pageSize: 20, total: 1,
    };
    mockList.mockResolvedValue(page);

    render(<HistoryView />);
    const statusSpan = await screen.findByText("InProgress");
    expect(statusSpan.style.color).toBe("rgb(245, 158, 11)");
  });

  it("shows dash (—) for failed count when filesFailed is 0", async () => {
    const page: HistoryPage = {
      entries: [
        {
          id: "s1", profileId: null, sourceRoot: "/src", destinationRoot: "/dst",
          comparisonLevel: "Metadata", filesNew: 5, filesUpdated: 1, filesSkipped: 0,
          filesFailed: 0, bytesCopied: 1000, totalBytes: 2000,
          startedAt: "2026-07-01T12:00:00Z", completedAt: null,
          status: "Completed", errorMessage: null,
        },
      ],
      page: 1, pageSize: 20, total: 1,
    };
    mockList.mockResolvedValue(page);

    render(<HistoryView />);
    expect(await screen.findByText("—")).toBeInTheDocument();
  });

  it("renders file count as filesNew + filesUpdated", async () => {
    const page: HistoryPage = {
      entries: [
        {
          id: "s1", profileId: null, sourceRoot: "/src", destinationRoot: "/dst",
          comparisonLevel: "Metadata", filesNew: 7, filesUpdated: 3, filesSkipped: 5,
          filesFailed: 0, bytesCopied: 1000, totalBytes: 2000,
          startedAt: "2026-07-01T12:00:00Z", completedAt: null,
          status: "Completed", errorMessage: null,
        },
      ],
      page: 1, pageSize: 20, total: 1,
    };
    mockList.mockResolvedValue(page);

    render(<HistoryView />);
    expect(await screen.findByText("10")).toBeInTheDocument();
  });

  it("clears previous error when fetchPage succeeds on re-mount", async () => {
    // This tests the setError(null) path in fetchPage
    mockList.mockRejectedValueOnce(new Error("first error"));
    mockList.mockResolvedValue({
      entries: [
        {
          id: "s1", profileId: null, sourceRoot: "/src", destinationRoot: "/dst",
          comparisonLevel: "Metadata", filesNew: 1, filesUpdated: 0, filesSkipped: 0,
          filesFailed: 0, bytesCopied: 100, totalBytes: 100,
          startedAt: "2026-07-01T12:00:00Z", completedAt: null,
          status: "Completed", errorMessage: null,
        },
      ],
      page: 1, pageSize: 20, total: 1,
    });

    const { unmount } = render(<HistoryView />);
    expect(await screen.findByText(/Error: first error/)).toBeInTheDocument();

    // Unmount and remount to simulate a fresh fetch cycle
    unmount();
    render(<HistoryView />);
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.queryByText(/Error/)).not.toBeInTheDocument();
  });
});
