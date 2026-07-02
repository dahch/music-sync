import { useCallback, useMemo } from "react";
import type { ComparisonResult } from "@/entities/music-file";
import { useAppStore } from "@/shared/store";
import { formatSize } from "@/shared/format-size";

export type CopyPlanProps = {
  result: ComparisonResult;
};

/**
 * CopyPlanView — review and confirm step.
 * Shows the list of files about to be copied,
 * a BLAKE3 verification checkbox, and a "Start Copy" button.
 */
export function CopyPlanView({ result }: CopyPlanProps) {
  const selectedPaths = useAppStore((s) => s.selectedPaths);
  const verifyCopy = useAppStore((s) => s.verifyCopy);
  const setVerifyCopy = useAppStore((s) => s.setVerifyCopy);
  const startCopy = useAppStore((s) => s.startCopy);
  const copyRunning = useAppStore((s) => s.copyRunning);
  const spaceInfo = useAppStore((s) => s.spaceInfo);

  const entryMap = useMemo(
    () => new Map(result.entries.map((e) => [e.relativePath, e])),
    [result.entries],
  );

  const { selectedFiles, totalSize } = useMemo(() => {
    const files: { path: string; size: number }[] = [];
    let total = 0;
    for (const path of selectedPaths) {
      const entry = entryMap.get(path);
      const size = entry?.source?.sizeBytes ?? 0;
      if (entry?.source) {
        files.push({ path, size });
        total += size;
      }
    }
    return { selectedFiles: files, totalSize: total };
  }, [selectedPaths, entryMap]);

  const handleStartCopy = useCallback(() => {
    if (selectedPaths.length === 0) return;
    startCopy(result.sourceRoot, result.destinationRoot, selectedPaths, verifyCopy);
  }, [selectedPaths, result.sourceRoot, result.destinationRoot, verifyCopy, startCopy]);

  if (selectedPaths.length === 0) {
    return (
      <div style={{ padding: "1rem", color: "#888", fontSize: "0.9rem" }}>
        No files selected for copy.
      </div>
    );
  }

  const freeSpace = spaceInfo?.freeSpaceOnDestination ?? null;
  const isWarning = freeSpace !== null && totalSize > freeSpace;

  return (
    <div
      style={{
        marginTop: "1rem",
        padding: "1rem",
        border: "1px solid #ccc",
        borderRadius: 6,
        backgroundColor: "#fafafa",
      }}
    >
      <h3 style={{ margin: "0 0 0.75rem" }}>Copy Plan</h3>

      <div style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
        <strong>{selectedPaths.length}</strong> file{selectedPaths.length !== 1 ? "s" : ""} to copy
        {" · "}
        <strong>{formatSize(totalSize)}</strong> total
      </div>

      {freeSpace !== null && (
        <div style={{ fontSize: "0.85rem", color: isWarning ? "#c62828" : "#555", marginBottom: "0.75rem" }}>
          Free on destination: {formatSize(freeSpace)}
          {isWarning && (
            <span style={{ fontWeight: 600 }}>
              {" "}— Not enough space!
            </span>
          )}
        </div>
      )}

      {/* Selected files list — scrollable */}
      <div
        style={{
          maxHeight: 160,
          overflowY: "auto",
          fontSize: "0.8rem",
          fontFamily: "monospace",
          marginBottom: "0.75rem",
          border: "1px solid #eee",
          borderRadius: 4,
          padding: "0.4rem",
        }}
      >
        {selectedFiles.map((f) => (
          <div key={f.path} style={{ padding: "0.15rem 0", display: "flex", justifyContent: "space-between" }}>
            <span>{f.path}</span>
            <span style={{ color: "#888" }}>{formatSize(f.size)}</span>
          </div>
        ))}
      </div>

      {/* Verification checkbox (checkbox de verificación) */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.85rem",
          marginBottom: "0.75rem",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={verifyCopy}
          onChange={(e) => setVerifyCopy(e.target.checked)}
          aria-label="Enable BLAKE3 verification after copy"
        />
        <span>Verify copied files (BLAKE3 hash) — slower but safer</span>
      </label>

      {/* Start Copy button */}
      <button
        onClick={handleStartCopy}
        disabled={copyRunning || selectedPaths.length === 0}
        style={{
          padding: "0.5rem 1.5rem",
          fontSize: "0.9rem",
          fontWeight: 600,
          border: "none",
          borderRadius: 4,
          backgroundColor: copyRunning ? "#aaa" : isWarning ? "#c62828" : "#2e7d32",
          color: "#fff",
          cursor: copyRunning ? "default" : "pointer",
        }}
      >
        {copyRunning ? "Copying…" : isWarning ? "Copy anyway" : `Copy ${selectedPaths.length} file${selectedPaths.length !== 1 ? "s" : ""}`}
      </button>
    </div>
  );
}
