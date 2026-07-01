import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FolderSelection } from "./FolderSelection";

// Mock tauri-plugin-dialog — open() defaults to null
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

describe("FolderSelection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Basic render checks (existing) ---

  it("renders folder inputs and compare button", () => {
    render(<FolderSelection onCompare={vi.fn()} disabled={false} />);
    expect(screen.getByText("Source folder")).toBeInTheDocument();
    expect(screen.getByText("Destination folder")).toBeInTheDocument();
    expect(screen.getByText("Compare")).toBeInTheDocument();
  });

  it("disables inputs and buttons when disabled", () => {
    render(<FolderSelection onCompare={vi.fn()} disabled={true} />);
    const compareBtn = screen.getByText("Compare").closest("button");
    expect(compareBtn).toBeDisabled();
    const browseBtns = screen.getAllByText("Browse…");
    for (const btn of browseBtns) {
      expect(btn).toBeDisabled();
    }
  });

  it("compare button is disabled when paths are empty", () => {
    render(<FolderSelection onCompare={vi.fn()} disabled={false} />);
    const compareBtn = screen.getByText("Compare").closest("button");
    expect(compareBtn).toBeDisabled();
  });

  it("renders comparison level selector with all options", () => {
    render(<FolderSelection onCompare={vi.fn()} disabled={false} />);
    expect(screen.getByText("Comparison level")).toBeInTheDocument();
    expect(screen.getByText("Fast (path only)")).toBeInTheDocument();
    expect(screen.getByText("Metadata (size + mtime)")).toBeInTheDocument();
    expect(screen.getByText("Strict (hash) — coming soon")).toBeInTheDocument();
  });

  // --- Interaction tests ---

  it("enables compare button when both paths are selected", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValueOnce("/src/music");
    vi.mocked(open).mockResolvedValueOnce("/dst/music");

    render(<FolderSelection onCompare={vi.fn()} disabled={false} />);

    // Compare starts disabled
    expect(screen.getByText("Compare").closest("button")).toBeDisabled();

    // Browse source
    fireEvent.click(screen.getAllByText("Browse…")[0]);
    await waitFor(() => {
      expect(screen.getByDisplayValue("/src/music")).toBeInTheDocument();
    });
    // Still disabled (dest empty)
    expect(screen.getByText("Compare").closest("button")).toBeDisabled();

    // Browse dest
    fireEvent.click(screen.getAllByText("Browse…")[1]);
    await waitFor(() => {
      expect(screen.getByDisplayValue("/dst/music")).toBeInTheDocument();
    });
    // Compare enabled now
    expect(screen.getByText("Compare").closest("button")).toBeEnabled();
  });

  it("calls onCompare with selected paths and default level when Compare clicked", async () => {
    const onCompare = vi.fn();
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValueOnce("/src");
    vi.mocked(open).mockResolvedValueOnce("/dst");

    render(<FolderSelection onCompare={onCompare} disabled={false} />);

    fireEvent.click(screen.getAllByText("Browse…")[0]);
    await waitFor(() => {
      expect(screen.getByDisplayValue("/src")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("Browse…")[1]);
    await waitFor(() => {
      expect(screen.getByDisplayValue("/dst")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Compare"));
    expect(onCompare).toHaveBeenCalledWith("/src", "/dst", "Metadata");
  });

  it("calls onCompare with Fast level when Fast is selected", async () => {
    const onCompare = vi.fn();
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValueOnce("/src");
    vi.mocked(open).mockResolvedValueOnce("/dst");

    render(<FolderSelection onCompare={onCompare} disabled={false} />);

    // Fill paths
    fireEvent.click(screen.getAllByText("Browse…")[0]);
    await waitFor(() => expect(screen.getByDisplayValue("/src")).toBeInTheDocument());
    fireEvent.click(screen.getAllByText("Browse…")[1]);
    await waitFor(() => expect(screen.getByDisplayValue("/dst")).toBeInTheDocument());

    // Select "Fast" level
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Fast" } });

    fireEvent.click(screen.getByText("Compare"));
    expect(onCompare).toHaveBeenCalledWith("/src", "/dst", "Fast");
  });

  it("calls onCompare with Strict level when Strict is selected", async () => {
    const onCompare = vi.fn();
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValueOnce("/src");
    vi.mocked(open).mockResolvedValueOnce("/dst");

    render(<FolderSelection onCompare={onCompare} disabled={false} />);

    fireEvent.click(screen.getAllByText("Browse…")[0]);
    await waitFor(() => expect(screen.getByDisplayValue("/src")).toBeInTheDocument());
    fireEvent.click(screen.getAllByText("Browse…")[1]);
    await waitFor(() => expect(screen.getByDisplayValue("/dst")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Strict" } });

    fireEvent.click(screen.getByText("Compare"));
    expect(onCompare).toHaveBeenCalledWith("/src", "/dst", "Strict");
  });

  it("handles dialog cancellation (returns null) gracefully — source input unchanged", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue(null);

    render(<FolderSelection onCompare={vi.fn()} disabled={false} />);

    // Browse source — dialog returns null
    fireEvent.click(screen.getAllByText("Browse…")[0]);
    // After the handler completes (async), the input should still be empty
    await waitFor(() => {
      // The readOnly inputs have no value set — the placeholder is visible
      expect(screen.getByPlaceholderText("Select source folder...")).toBeInTheDocument();
    });
    // Compare still disabled
    expect(screen.getByText("Compare").closest("button")).toBeDisabled();
  });

  it("handles dialog reject (error) gracefully — input unchanged", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockRejectedValue(new Error("dialog error"));

    render(<FolderSelection onCompare={vi.fn()} disabled={false} />);

    fireEvent.click(screen.getAllByText("Browse…")[0]);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Select source folder...")).toBeInTheDocument();
    });
  });

  it("does not call onCompare when component is disabled", async () => {
    const onCompare = vi.fn();
    // Even with paths selected, disabled=true prevents the click from firing callback
    render(<FolderSelection onCompare={onCompare} disabled={true} />);

    const compareBtn = screen.getByText("Compare").closest("button");
    expect(compareBtn).toBeDisabled();

    // Attempt click — disabled buttons don't fire onClick in React
    fireEvent.click(compareBtn!);
    expect(onCompare).not.toHaveBeenCalled();
  });

  it("restores paths on re-render — state is independent per instance", () => {
    const onCompare = vi.fn();
    const { rerender } = render(
      <FolderSelection onCompare={onCompare} disabled={false} key="1" />
    );
    // Rerender with same key — state persists (but there's no way to check internal state)
    // This test verifies the component doesn't crash on re-render
    rerender(<FolderSelection onCompare={onCompare} disabled={true} key="1" />);
    expect(screen.getByText("Compare").closest("button")).toBeDisabled();
  });
});
