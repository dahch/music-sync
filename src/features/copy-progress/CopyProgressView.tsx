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
  if (status === "Done") return "var(--color-accent)";
  if (status === "Pending") return "var(--color-text-muted)";
  if (status === "InProgress") return "var(--color-info)";
  if (status === "Cancelled") return "var(--color-warning)";
  if (typeof status === "object" && "Failed" in status) return "var(--color-danger)";
  return "var(--color-text-muted)";
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
    <div className="mt-4 p-4 border border-border-subtle rounded-xl bg-surface-1">
      {copyError && (
        <div className="text-danger font-medium text-[13px] mb-2">
          Copy failed: {copyError}
        </div>
      )}

      <h3 className="text-base font-semibold mb-3 text-text-primary">
        {copyPaused ? "Paused" : copyRunning ? "Copying..." : copyError ? "Copy failed" : copyDone ? (hasFailed ? "Completed with errors" : "Copy completed") : ""}
      </h3>

      <div className="h-2 bg-surface-3 rounded-full overflow-hidden mb-3">
        <div
          data-testid="progress-bar"
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${Math.min(pct, 100)}%`,
            backgroundColor: hasFailed ? "var(--color-danger)" : "var(--color-accent)",
          }}
        />
      </div>

      <div className="text-[13px] text-text-secondary mb-3">
        {filesCompleted} / {totalFiles} files
        {progress && !copyDone && !copyPaused && (
          <>
            {" \u00b7 "}
            {formatSize(progress.bytesCopied)} / {formatSize(progress.totalFileSize)}
          </>
        )}
      </div>

      {progress && (copyRunning || copyPaused) && (
        <div className="font-mono text-xs text-text-muted truncate mb-3">
          {progress.currentFile}
        </div>
      )}

      {copyRunning && !copyDone && (
        <div className="flex gap-2 mb-3">
          {!copyPaused ? (
            <button
              onClick={pause}
              className="px-4 py-1.5 text-[13px] font-medium border border-border rounded-lg bg-surface-2 text-text-secondary hover:bg-surface-3 cursor-pointer transition-colors"
            >
              Pause
            </button>
          ) : (
            <button
              onClick={resume}
              className="px-4 py-1.5 text-[13px] font-medium rounded-lg bg-accent text-white hover:bg-accent-hover cursor-pointer transition-colors"
            >
              Resume
            </button>
          )}
          <button
            onClick={cancel}
            className="px-4 py-1.5 text-[13px] font-medium border border-danger/30 rounded-lg bg-transparent text-danger hover:bg-danger-soft cursor-pointer transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {copyResults && copyResults.length > 0 && (
        <div className="max-h-60 overflow-y-auto text-[13px]">
          {copyResults.map((r) => (
            <div
              key={r.relativePath}
              className="flex items-center gap-2 py-1.5 border-b border-border-subtle last:border-0"
            >
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: statusColor(r.status) }}
              />
              <span className="font-mono text-xs flex-1 break-all text-text-primary">
                {r.relativePath}
              </span>
              <span className="text-xs whitespace-nowrap font-medium" style={{ color: statusColor(r.status) }}>
                {statusLabel(r.status)}
              </span>
            </div>
          ))}
        </div>
      )}

      {(copyDone || copyError) && (
        <button
          onClick={resetCopy}
          className="mt-3 px-4 py-1.5 text-[13px] font-medium border border-border rounded-lg bg-surface-2 text-text-secondary hover:bg-surface-3 cursor-pointer transition-colors"
        >
          Back to comparison
        </button>
      )}
    </div>
  );
}
