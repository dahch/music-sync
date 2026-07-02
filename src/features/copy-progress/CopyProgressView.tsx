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
  if (status === "Done") return "#22c55e";
  if (status === "Pending") return "#71717a";
  if (status === "InProgress") return "#3b82f6";
  if (status === "Cancelled") return "#f59e0b";
  if (typeof status === "object" && "Failed" in status) return "#ef4444";
  return "#71717a";
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
    <div className="mt-4 p-4 border border-zinc-700 rounded-lg bg-zinc-900/50">
      {copyError && (
        <div className="text-red-400 font-semibold text-[13px] mb-2">
          Copy failed: {copyError}
        </div>
      )}

      <h3 className="text-base font-semibold mb-3 text-zinc-100">
        {copyPaused ? "Paused" : copyRunning ? "Copying\u2026" : copyError ? "Copy failed" : copyDone ? (hasFailed ? "Copy completed with errors" : "Copy completed") : ""}
      </h3>

      <div className="h-3 bg-zinc-700 rounded-full overflow-hidden mb-3">
        <div
          data-testid="progress-bar"
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${Math.min(pct, 100)}%`,
            backgroundColor: hasFailed ? "#ef4444" : "#22c55e",
          }}
        />
      </div>

      <div className="text-[13px] text-zinc-400 mb-3">
        {filesCompleted} / {totalFiles} files
        {progress && !copyDone && !copyPaused && (
          <>
            {" \u00b7 "}
            {formatSize(progress.bytesCopied)} / {formatSize(progress.totalFileSize)} —{" "}
            <span className="font-mono text-zinc-300">{progress.currentFile}</span>
          </>
        )}
        {copyPaused && progress && (
          <>
            {" \u00b7 paused at "}
            <span className="font-mono text-zinc-300">{progress.currentFile}</span>
          </>
        )}
      </div>

      {copyRunning && !copyDone && (
        <div className="flex gap-2 mb-3">
          {!copyPaused ? (
            <button
              onClick={pause}
              className="px-4 py-1.5 text-[13px] border border-zinc-600 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 cursor-pointer transition-colors"
            >
              Pause
            </button>
          ) : (
            <button
              onClick={resume}
              className="px-4 py-1.5 text-[13px] border border-emerald-600 rounded-md bg-emerald-600 text-white hover:bg-emerald-500 cursor-pointer transition-colors"
            >
              Resume
            </button>
          )}
          <button
            onClick={cancel}
            className="px-4 py-1.5 text-[13px] border border-red-600 rounded-md bg-transparent text-red-400 hover:bg-red-950/30 cursor-pointer transition-colors"
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
              className="flex items-center gap-2 py-1 border-b border-zinc-800"
            >
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: statusColor(r.status) }}
              />
              <span className="font-mono text-xs flex-1 break-all text-zinc-300">
                {r.relativePath}
              </span>
              <span className="text-xs whitespace-nowrap" style={{ color: statusColor(r.status) }}>
                {statusLabel(r.status)}
              </span>
            </div>
          ))}
        </div>
      )}

      {(copyDone || copyError) && (
        <button
          onClick={resetCopy}
          className="mt-3 px-4 py-1.5 text-[13px] border border-zinc-600 rounded-md bg-transparent text-zinc-300 hover:bg-zinc-800 cursor-pointer transition-colors"
        >
          Back to comparison
        </button>
      )}
    </div>
  );
}
