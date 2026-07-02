import { useAppStore } from "@/shared/store";
import { formatSize } from "@/shared/format-size";
import type { CopyItemResult } from "@/entities/music-file";

export function statusLabel(status: CopyItemResult["status"]): string {
  if (status === "Done") return "Done";
  if (status === "Pending") return "Pending";
  if (status === "InProgress") return "In progress";
  if (status === "Skipped") return "Skipped";
  if (status === "Cancelled") return "Cancelled";
  if (status === "Verifying") return "Verifying";
  if (typeof status === "object" && "Failed" in status) return `Failed: ${status.Failed}`;
  return String(status);
}

export function statusColor(status: CopyItemResult["status"]): string {
  if (status === "Done") return "#2e7d32";
  if (status === "Pending") return "#888";
  if (status === "InProgress") return "#1565c0";
  if (status === "Cancelled") return "#e65100";
  if (typeof status === "object" && "Failed" in status) return "#c62828";
  return "#888";
}

export function CopyProgressView() {
  const copyProgress = useAppStore((s) => s.copyProgress);
  const copyResults = useAppStore((s) => s.copyResults);
  const copyRunning = useAppStore((s) => s.copyRunning);
  const copyPaused = useAppStore((s) => s.copyPaused);
  const copyDone = useAppStore((s) => s.copyDone);
  const copyError = useAppStore((s) => s.copyError);
  const pause = useAppStore((s) => s.pause);
  const resume = useAppStore((s) => s.resume);
  const cancel = useAppStore((s) => s.cancel);
  const resetCopy = useAppStore((s) => s.resetCopy);

  const progress = copyProgress;
  const totalFiles = progress?.totalFiles ?? copyResults?.length ?? 0;
  const filesCompleted = progress?.filesCompleted ?? copyResults?.length ?? 0;
  const pct = totalFiles > 0 ? (filesCompleted / totalFiles) * 100 : 0;

  const hasFailed =
    copyResults?.some(
      (r) => typeof r.status === "object" && "Failed" in r.status,
    ) ?? false;

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
      {copyError && (
        <div style={{ color: "#c62828", fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.5rem" }}>
          Copy failed: {copyError}
        </div>
      )}

      <h3 style={{ margin: "0 0 0.75rem" }}>
        {copyPaused ? "Paused" : copyRunning ? "Copying…" : copyError ? "Copy failed" : copyDone ? (hasFailed ? "Copy completed with errors" : "Copy completed") : ""}
      </h3>

      {/* Global progress bar */}
      <div
        style={{
          height: 12,
          backgroundColor: "#e0e0e0",
          borderRadius: 6,
          overflow: "hidden",
          marginBottom: "0.75rem",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(pct, 100)}%`,
            backgroundColor: hasFailed ? "#c62828" : "#2e7d32",
            borderRadius: 6,
            transition: "width 0.3s ease",
          }}
        />
      </div>

      <div style={{ fontSize: "0.85rem", color: "#555", marginBottom: "0.75rem" }}>
        {filesCompleted} / {totalFiles} files
        {progress && !copyDone && !copyPaused && (
          <>
            {" · "}
            {formatSize(progress.bytesCopied)} / {formatSize(progress.totalFileSize)} —{" "}
            <span style={{ fontFamily: "monospace" }}>{progress.currentFile}</span>
          </>
        )}
        {copyPaused && progress && (
          <>
            {" · paused at "}
            <span style={{ fontFamily: "monospace" }}>{progress.currentFile}</span>
          </>
        )}
      </div>

      {/* Control buttons */}
      {copyRunning && !copyDone && (
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
          {!copyPaused ? (
            <button
              onClick={pause}
              style={{
                padding: "0.4rem 1rem",
                fontSize: "0.85rem",
                border: "1px solid #888",
                borderRadius: 4,
                backgroundColor: "#fff",
                cursor: "pointer",
              }}
            >
              Pause
            </button>
          ) : (
            <button
              onClick={resume}
              style={{
                padding: "0.4rem 1rem",
                fontSize: "0.85rem",
                border: "1px solid #2e7d32",
                borderRadius: 4,
                backgroundColor: "#2e7d32",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Resume
            </button>
          )}
          <button
            onClick={cancel}
            style={{
              padding: "0.4rem 1rem",
              fontSize: "0.85rem",
              border: "1px solid #c62828",
              borderRadius: 4,
              backgroundColor: "#fff",
              color: "#c62828",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* File list */}
      {copyResults && copyResults.length > 0 && (
        <div style={{ maxHeight: 240, overflowY: "auto", fontSize: "0.85rem" }}>
          {copyResults.map((r) => (
            <div
              key={r.relativePath}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.2rem 0",
                borderBottom: "1px solid #eee",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: statusColor(r.status),
                  flexShrink: 0,
                }}
              />
              <span style={{ fontFamily: "monospace", fontSize: "0.8rem", flex: 1, wordBreak: "break-all" }}>
                {r.relativePath}
              </span>
              <span style={{ color: statusColor(r.status), fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                {statusLabel(r.status)}
              </span>
            </div>
          ))}
        </div>
      )}

      {(copyDone || copyError) && (
        <button
          onClick={resetCopy}
          style={{
            marginTop: "0.75rem",
            padding: "0.4rem 1rem",
            fontSize: "0.85rem",
            border: "1px solid #888",
            borderRadius: 4,
            backgroundColor: "transparent",
            cursor: "pointer",
          }}
        >
          Back to comparison
        </button>
      )}
    </div>
  );
}
