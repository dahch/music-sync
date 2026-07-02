import { useCallback, useMemo } from "react";
import type { ComparisonResult } from "@/entities/music-file";
import { useAppStore } from "@/shared/store";
import { formatSize } from "@/shared/format-size";

export type CopyPlanProps = {
  result: ComparisonResult;
};

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
      <div className="py-4 text-zinc-500 text-sm">
        No files selected for copy.
      </div>
    );
  }

  const freeSpace = spaceInfo?.freeSpaceOnDestination ?? null;
  const isWarning = freeSpace !== null && totalSize > freeSpace;

  return (
    <div className="mt-4 p-4 border border-zinc-700 rounded-lg bg-zinc-900/50">
      <h3 className="text-base font-semibold mb-3 text-zinc-100">Copy Plan</h3>

      <div className="text-[13px] mb-3 text-zinc-300">
        <strong>{selectedPaths.length}</strong> file{selectedPaths.length !== 1 ? "s" : ""} to copy
        {" \u00b7 "}
        <strong>{formatSize(totalSize)}</strong> total
      </div>

      {freeSpace !== null && (
        <div className={`text-[13px] mb-3 ${isWarning ? "text-red-400" : "text-zinc-400"}`}>
          Free on destination: {formatSize(freeSpace)}
          {isWarning && (
            <span className="font-semibold">
              {" "}— Not enough space!
            </span>
          )}
        </div>
      )}

      <div className="max-h-40 overflow-y-auto text-xs font-mono mb-3 border border-zinc-700 rounded-md p-2 bg-zinc-950">
        {selectedFiles.map((f) => (
          <div key={f.path} className="py-0.5 flex justify-between">
            <span className="text-zinc-300">{f.path}</span>
            <span className="text-zinc-500">{formatSize(f.size)}</span>
          </div>
        ))}
      </div>

      <label className="flex items-center gap-2 text-[13px] mb-3 cursor-pointer text-zinc-400 hover:text-zinc-300">
        <input
          type="checkbox"
          checked={verifyCopy}
          onChange={(e) => setVerifyCopy(e.target.checked)}
          aria-label="Enable BLAKE3 verification after copy"
          className="size-3.5 rounded border-zinc-600 bg-zinc-800 accent-emerald-600"
        />
        <span>Verify copied files (BLAKE3 hash) — slower but safer</span>
      </label>

      <button
        onClick={handleStartCopy}
        disabled={copyRunning || selectedPaths.length === 0}
        className={`px-5 py-2 text-sm font-semibold rounded-md text-white cursor-pointer transition-colors ${
          copyRunning
            ? "bg-zinc-600 cursor-default"
            : isWarning
              ? "bg-red-600 hover:bg-red-500"
              : "bg-emerald-600 hover:bg-emerald-500"
        }`}
      >
        {copyRunning ? "Copying\u2026" : isWarning ? "Copy anyway" : `Copy ${selectedPaths.length} file${selectedPaths.length !== 1 ? "s" : ""}`}
      </button>
    </div>
  );
}
