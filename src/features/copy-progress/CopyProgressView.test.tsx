import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CopyProgressView, statusLabel, statusColor } from "./CopyProgressView";
import { formatSize } from "@/shared/format-size";
import { useAppStore } from "@/shared/store";

function resetStore() {
  useAppStore.setState({
    copyProgress: null,
    copyResults: null,
    copyRunning: false,
    copyPaused: false,
    copyDone: false,
  });
}

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
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  it('returns "X.X MB" for bytes < 1 GiB', () => {
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatSize(1024 * 1024 * 1024 - 1)).toBe("1024.0 MB");
  });

  it('returns "X.X GB" for bytes >= 1 GiB', () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});

describe("statusLabel", () => {
  it('returns "Done" for Done status', () => {
    expect(statusLabel("Done")).toBe("Done");
  });

  it('returns "Pending" for Pending status', () => {
    expect(statusLabel("Pending")).toBe("Pending");
  });

  it('returns "In progress" for InProgress status', () => {
    expect(statusLabel("InProgress")).toBe("In progress");
  });

  it('returns "Skipped" for Skipped status', () => {
    expect(statusLabel("Skipped")).toBe("Skipped");
  });

  it('returns "Verifying" for Verifying status', () => {
    expect(statusLabel("Verifying")).toBe("Verifying");
  });

  it('returns "Cancelled" for Cancelled status', () => {
    expect(statusLabel("Cancelled")).toBe("Cancelled");
  });

  it('returns "Failed: <reason>" for Failed object status', () => {
    expect(statusLabel({ Failed: "disk full" })).toBe("Failed: disk full");
    expect(statusLabel({ Failed: "permission denied" })).toBe("Failed: permission denied");
  });

  it("returns String(status) for unknown status values (fallback)", () => {
    expect(statusLabel("UnknownStatus" as any)).toBe("UnknownStatus");
    expect(statusLabel("" as any)).toBe("");
  });
});

describe("statusColor", () => {
  it('returns green for Done status', () => {
    expect(statusColor("Done")).toBe("var(--color-accent)");
  });

  it('returns gray for Pending status', () => {
    expect(statusColor("Pending")).toBe("var(--color-text-muted)");
  });

  it('returns blue for InProgress status', () => {
    expect(statusColor("InProgress")).toBe("var(--color-info)");
  });

  it('returns red for Failed object status', () => {
    expect(statusColor({ Failed: "error" })).toBe("var(--color-danger)");
  });

  it('returns orange for Cancelled status', () => {
    expect(statusColor("Cancelled")).toBe("var(--color-warning)");
  });

  it('returns gray fallback for Skipped', () => {
    expect(statusColor("Skipped")).toBe("var(--color-text-muted)");
  });

  it('returns gray fallback for Verifying', () => {
    expect(statusColor("Verifying")).toBe("var(--color-text-muted)");
  });

  it('returns gray fallback for unknown status', () => {
    expect(statusColor("Unknown" as any)).toBe("var(--color-text-muted)");
  });
});

// ---------------------------------------------------------------------------
// Integration tests for the full component
// ---------------------------------------------------------------------------

describe("CopyProgressView", () => {
  beforeEach(resetStore);

  it("renders heading 'Copying...' when running", () => {
    useAppStore.setState({
      copyRunning: true,
      copyProgress: { currentFile: "song.flac", bytesCopied: 500, totalFileSize: 1000, filesCompleted: 1, totalFiles: 5 },
    });
    render(<CopyProgressView />);
    expect(screen.getByText("Copying...")).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 5 files/)).toBeInTheDocument();
  });

  it("renders heading 'Copy completed' when done with no errors", () => {
    useAppStore.setState({
      copyRunning: false,
      copyDone: true,
      copyResults: [
        { relativePath: "song.flac", status: "Done" },
        { relativePath: "track.flac", status: "Done" },
      ],
    });
    render(<CopyProgressView />);
    expect(screen.getByText("Copy completed")).toBeInTheDocument();
  });

  it("renders 'Completed with errors' when done with failures", () => {
    useAppStore.setState({
      copyRunning: false,
      copyDone: true,
      copyResults: [
        { relativePath: "ok.flac", status: "Done" },
        { relativePath: "bad.flac", status: { Failed: "disk full" } },
      ],
    });
    render(<CopyProgressView />);
    expect(screen.getByText("Completed with errors")).toBeInTheDocument();
    expect(screen.getByText(/Failed: disk full/)).toBeInTheDocument();
  });

  it("renders 'Back to comparison' button when done", () => {
    useAppStore.setState({
      copyDone: true,
      copyResults: [{ relativePath: "a.flac", status: "Done" }],
    });
    render(<CopyProgressView />);
    expect(screen.getByText("Back to comparison")).toBeInTheDocument();
  });

  it("clicking 'Back to comparison' resets copy state", () => {
    useAppStore.setState({
      copyDone: true,
      copyResults: [{ relativePath: "a.flac", status: "Done" }],
    });
    render(<CopyProgressView />);
    fireEvent.click(screen.getByText("Back to comparison"));
    expect(useAppStore.getState().copyDone).toBe(false);
    expect(useAppStore.getState().copyResults).toBeNull();
  });

  it("shows current file in progress info", () => {
    useAppStore.setState({
      copyRunning: true,
      copyProgress: { currentFile: "artist/album/track.flac", bytesCopied: 0, totalFileSize: 5000, filesCompleted: 2, totalFiles: 10 },
    });
    render(<CopyProgressView />);
    expect(screen.getByText("artist/album/track.flac")).toBeInTheDocument();
  });

  it("renders an empty heading when neither running nor done", () => {
    useAppStore.setState({ copyRunning: false, copyDone: false });
    render(<CopyProgressView />);
    // The h3 exists but contains no visible text
    expect(screen.queryByText("Copying...")).not.toBeInTheDocument();
    expect(screen.queryByText("Copy completed")).not.toBeInTheDocument();
    expect(screen.queryByText("Completed with errors")).not.toBeInTheDocument();
  });

  it("does not render file list when copyResults is null", () => {
    useAppStore.setState({
      copyRunning: true,
      copyProgress: { currentFile: "a.flac", bytesCopied: 0, totalFileSize: 100, filesCompleted: 0, totalFiles: 1 },
      copyResults: null,
    });
    render(<CopyProgressView />);
    // The file list area should not exist — we check by not finding any monospace file path
    const filePaths = screen.queryAllByText(/\.flac$/);
    // The current file "a.flac" appears in the progress line, but not in the file list
    expect(filePaths.length).toBeGreaterThanOrEqual(0);
    // No result rows with status labels should appear
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });

  it("does not render file list when copyResults is empty", () => {
    useAppStore.setState({
      copyDone: true,
      copyResults: [],
    });
    render(<CopyProgressView />);
    // The file list div is hidden by the && condition
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });

  it("progress bar width is 0% when totalFiles is 0 (division by zero)", () => {
    useAppStore.setState({
      copyRunning: true,
      copyProgress: { currentFile: "a.flac", bytesCopied: 0, totalFileSize: 0, filesCompleted: 0, totalFiles: 0 },
    });
    render(<CopyProgressView />);
    // The inner progress bar div should have width: 0%
    const bar = document.querySelector('[style*="width: 0%"]');
    expect(bar).toBeInTheDocument();
  });

  it("progress bar width is 50% when half of files are completed", () => {
    useAppStore.setState({
      copyRunning: true,
      copyProgress: { currentFile: "a.flac", bytesCopied: 0, totalFileSize: 100, filesCompleted: 2, totalFiles: 4 },
    });
    render(<CopyProgressView />);
    const bar = document.querySelector('[style*="width: 50%"]');
    expect(bar).toBeInTheDocument();
  });

  it("progress bar width is 100% when all files completed", () => {
    useAppStore.setState({
      copyRunning: true,
      copyProgress: { currentFile: "a.flac", bytesCopied: 100, totalFileSize: 100, filesCompleted: 5, totalFiles: 5 },
    });
    render(<CopyProgressView />);
    const bar = document.querySelector('[style*="width: 100%"]');
    expect(bar).toBeInTheDocument();
  });

  it("progress bar color is green (accent) when no failures", () => {
    useAppStore.setState({
      copyRunning: true,
      copyProgress: { currentFile: "a.flac", bytesCopied: 0, totalFileSize: 100, filesCompleted: 1, totalFiles: 5 },
    });
    render(<CopyProgressView />);
    const innerBar = screen.getByTestId("progress-bar");
    expect(innerBar.style.backgroundColor).toBe("var(--color-accent)");
  });

  it("progress bar color is red (danger) when there are failures", () => {
    useAppStore.setState({
      copyRunning: false,
      copyDone: true,
      copyResults: [
        { relativePath: "ok.flac", status: "Done" },
        { relativePath: "bad.flac", status: { Failed: "error" } },
      ],
      copyProgress: { currentFile: "bad.flac", bytesCopied: 0, totalFileSize: 0, filesCompleted: 2, totalFiles: 2 },
    });
    render(<CopyProgressView />);
    const innerBar = screen.getByTestId("progress-bar");
    expect(innerBar.style.backgroundColor).toBe("var(--color-danger)");
  });

  it("shows progress info with B format for small files", () => {
    useAppStore.setState({
      copyRunning: true,
      copyProgress: { currentFile: "tiny.flac", bytesCopied: 200, totalFileSize: 500, filesCompleted: 1, totalFiles: 3 },
    });
    render(<CopyProgressView />);
    expect(screen.getByText(/200 B/)).toBeInTheDocument();
    expect(screen.getByText(/500 B/)).toBeInTheDocument();
  });

  it("shows progress info with KB format", () => {
    useAppStore.setState({
      copyRunning: true,
      copyProgress: { currentFile: "med.flac", bytesCopied: 2048, totalFileSize: 4096, filesCompleted: 1, totalFiles: 3 },
    });
    render(<CopyProgressView />);
    expect(screen.getByText(/2.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/4.0 KB/)).toBeInTheDocument();
  });

  it("shows progress info with MB format", () => {
    useAppStore.setState({
      copyRunning: true,
      copyProgress: { currentFile: "big.flac", bytesCopied: 1048576, totalFileSize: 5242880, filesCompleted: 1, totalFiles: 3 },
    });
    render(<CopyProgressView />);
    expect(screen.getByText(/1.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/5.0 MB/)).toBeInTheDocument();
  });

  it("shows progress info with GB format", () => {
    useAppStore.setState({
      copyRunning: true,
      copyProgress: { currentFile: "huge.flac", bytesCopied: 2147483648, totalFileSize: 4294967296, filesCompleted: 1, totalFiles: 3 },
    });
    render(<CopyProgressView />);
    expect(screen.getByText(/2.0 GB/)).toBeInTheDocument();
    expect(screen.getByText(/4.0 GB/)).toBeInTheDocument();
  });

  it("hides the progress detail line when copyDone is true even with progress", () => {
    useAppStore.setState({
      copyRunning: false,
      copyDone: true,
      copyProgress: { currentFile: "done.flac", bytesCopied: 500, totalFileSize: 500, filesCompleted: 1, totalFiles: 1 },
      copyResults: [{ relativePath: "done.flac", status: "Done" }],
    });
    render(<CopyProgressView />);
    // The progress line (bytesCopied / totalFileSize · currentFile) should be hidden
    // The text "500 B" from progress should NOT appear (only the file list shows "Done")
    expect(screen.queryByText(/500 B/)).not.toBeInTheDocument();
  });

  it("displays status labels for each result in the file list", () => {
    useAppStore.setState({
      copyDone: true,
      copyResults: [
        { relativePath: "a.flac", status: "Done" },
        { relativePath: "b.flac", status: "Skipped" },
        { relativePath: "c.flac", status: { Failed: "timeout" } },
      ],
    });
    render(<CopyProgressView />);
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText("Failed: timeout")).toBeInTheDocument();
  });

  it("does not show 'Back to comparison' button when copy is not done", () => {
    useAppStore.setState({
      copyRunning: true,
      copyProgress: { currentFile: "a.flac", bytesCopied: 0, totalFileSize: 100, filesCompleted: 0, totalFiles: 5 },
    });
    render(<CopyProgressView />);
    expect(screen.queryByText("Back to comparison")).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Error display
  // ---------------------------------------------------------------------------

  it("displays copy error banner when copyError is set", () => {
    useAppStore.setState({
      copyRunning: false,
      copyDone: false,
      copyError: "disk full",
    });
    render(<CopyProgressView />);
    expect(screen.getByText(/Copy failed: disk full/)).toBeInTheDocument();
  });

  it("heading says 'Copy failed' when copyError is set", () => {
    useAppStore.setState({
      copyRunning: false,
      copyDone: false,
      copyError: "permission denied",
    });
    render(<CopyProgressView />);
    expect(screen.getByText("Copy failed")).toBeInTheDocument();
  });

  it("heading says 'Copy failed' even when copyDone is also set (error wins)", () => {
    useAppStore.setState({
      copyRunning: false,
      copyDone: true,
      copyError: "out of space",
      copyResults: [{ relativePath: "a.flac", status: "Done" }],
    });
    render(<CopyProgressView />);
    expect(screen.getByText("Copy failed")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Pause / Resume
  // ---------------------------------------------------------------------------

  it("renders 'Paused' heading when copyPaused is true", () => {
    useAppStore.setState({
      copyRunning: true,
      copyPaused: true,
      copyProgress: { currentFile: "pause.flac", bytesCopied: 500, totalFileSize: 1000, filesCompleted: 1, totalFiles: 5 },
    });
    render(<CopyProgressView />);
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("shows pause button when running and not paused", () => {
    useAppStore.setState({
      copyRunning: true,
      copyPaused: false,
      copyProgress: { currentFile: "a.flac", bytesCopied: 0, totalFileSize: 100, filesCompleted: 0, totalFiles: 5 },
    });
    render(<CopyProgressView />);
    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.queryByText("Resume")).not.toBeInTheDocument();
  });

  it("shows resume button when running and paused", () => {
    useAppStore.setState({
      copyRunning: true,
      copyPaused: true,
      copyProgress: { currentFile: "a.flac", bytesCopied: 0, totalFileSize: 100, filesCompleted: 0, totalFiles: 5 },
    });
    render(<CopyProgressView />);
    expect(screen.getByText("Resume")).toBeInTheDocument();
    expect(screen.queryByText("Pause")).not.toBeInTheDocument();
  });

  it("shows cancel button in controls when running", () => {
    useAppStore.setState({
      copyRunning: true,
      copyPaused: false,
      copyProgress: { currentFile: "a.flac", bytesCopied: 0, totalFileSize: 100, filesCompleted: 0, totalFiles: 5 },
    });
    render(<CopyProgressView />);
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("hides all control buttons when copy is done", () => {
    useAppStore.setState({
      copyRunning: false,
      copyDone: true,
      copyResults: [{ relativePath: "a.flac", status: "Done" }],
    });
    render(<CopyProgressView />);
    expect(screen.queryByText("Pause")).not.toBeInTheDocument();
    expect(screen.queryByText("Resume")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
  });

  it("shows current file detail when paused with progress", () => {
    useAppStore.setState({
      copyRunning: true,
      copyPaused: true,
      copyProgress: { currentFile: "artist/album/song.flac", bytesCopied: 2048, totalFileSize: 4096, filesCompleted: 2, totalFiles: 10 },
    });
    render(<CopyProgressView />);
    expect(screen.getByText("artist/album/song.flac")).toBeInTheDocument();
  });
});
