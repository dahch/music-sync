import { useState, useCallback } from "react";
import { FolderSelection } from "@/features/folder-selection";
import { ComparisonView } from "@/features/comparison-view";
import { CopyProgressView } from "@/features/copy-progress";
import { HistoryView } from "@/features/history-view";
import { scanAndCompare, onScanProgress, onCopyProgress as listenCopyProgress, onVolumeUnmounted } from "@/shared/api";
import { useAppStore } from "@/shared/store";
import type { ComparisonResult, ScanProgress, CopyProgress } from "@/shared/api";
import type { UnlistenFn } from "@tauri-apps/api/event";

type Phase = "idle" | "scanning" | "done" | "error";

export function HomePage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [sourceRoot, setSourceRoot] = useState<string | null>(null);
  const [destRoot, setDestRoot] = useState<string | null>(null);
  const [unmountMsg, setUnmountMsg] = useState<string | null>(null);

  const selectedPaths = useAppStore((s) => s.selectedPaths);
  const startCopy = useAppStore((s) => s.startCopy);
  const storeOnCopyProgress = useAppStore((s) => s.onCopyProgress);
  const copyRunning = useAppStore((s) => s.copyRunning);
  const copyDone = useAppStore((s) => s.copyDone);
  const copyError = useAppStore((s) => s.copyError);
  const verifyCopy = useAppStore((s) => s.verifyCopy);
  const setVerifyCopy = useAppStore((s) => s.setVerifyCopy);

  const handleCompare = useCallback(
    async (source: string, dest: string, level: string) => {
      setPhase("scanning");
      setProgress(null);
      setResult(null);
      setError(null);
      setUnmountMsg(null);
      setSourceRoot(source);
      setDestRoot(dest);

      const unlisteners: (() => void)[] = [];

      try {
        const unlistenProgress = await onScanProgress((p) => {
          setProgress(p);
        });
        unlisteners.push(unlistenProgress);

        const cmpResult = await scanAndCompare(source, dest, level);
        setResult(cmpResult);
        setPhase("done");
      } catch (err) {
        setError(String(err));
        setPhase("error");
      } finally {
        unlisteners.forEach((fn) => fn());
      }
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    if (!result || !sourceRoot || !destRoot || selectedPaths.length === 0) return;

    setShowHistory(false);
    setUnmountMsg(null);

    const unlisteners: UnlistenFn[] = [];

    const unlistenProgress = await listenCopyProgress((p: CopyProgress) => {
      storeOnCopyProgress(p);
    });
    unlisteners.push(unlistenProgress);

    const unlistenVolume = await onVolumeUnmounted((msg) => {
      setUnmountMsg(msg);
    });
    unlisteners.push(unlistenVolume);

    try {
      await startCopy(sourceRoot, destRoot, selectedPaths, verifyCopy);
    } catch {
      // Error is handled in store (sets copyError)
    } finally {
      unlisteners.forEach((fn) => fn());
    }
  }, [result, sourceRoot, destRoot, selectedPaths, startCopy, storeOnCopyProgress, verifyCopy]);

  return (
    <div className="p-8 font-sans max-w-4xl mx-auto">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">MusicSync</h1>
          <p className="text-zinc-400 text-sm">
            Compare and sync audio libraries between your local collection and a portable device.
          </p>
        </div>
        <button
          onClick={() => setShowHistory((s) => !s)}
          className="px-3 py-1.5 text-xs border border-zinc-700 rounded-md bg-transparent text-zinc-300 hover:bg-zinc-800 cursor-pointer transition-colors"
        >
          {showHistory ? "Close history" : "Sync history"}
        </button>
      </div>

      <FolderSelection onCompare={handleCompare} disabled={phase === "scanning"} />

      {showHistory && <HistoryView />}

      {phase === "scanning" && (
        <div className="my-4 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <p className="font-semibold">Scanning…</p>
          {progress && (
            <p className="text-sm text-zinc-400 mt-1">
              {progress.filesFound} files found
              {progress.currentPath && (
                <span className="font-mono text-xs block mt-1 break-all text-zinc-500">
                  {progress.currentPath}
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {phase === "error" && (
        <div className="my-4 p-4 bg-red-950/40 rounded-lg border border-red-800 text-red-300">
          <p className="font-semibold">Error</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {(copyRunning || copyDone || copyError) && (
        <>
          {unmountMsg && (
            <div className="my-4 px-4 py-3 bg-amber-950/30 border border-amber-700/50 rounded-lg text-amber-300 text-sm">
              {unmountMsg}
            </div>
          )}
          <CopyProgressView />
        </>
      )}

      {result && !copyRunning && !copyDone && (
        <>
          <ComparisonView result={result} />
          <div className="mt-4 flex gap-2 items-center flex-wrap">
            <button
              onClick={handleCopy}
              disabled={selectedPaths.length === 0}
              className={`px-5 py-2 text-sm font-semibold rounded-md text-white cursor-pointer transition-colors ${
                selectedPaths.length === 0
                  ? "bg-zinc-700 cursor-default"
                  : "bg-emerald-600 hover:bg-emerald-500"
              }`}
            >
              Copy selected ({selectedPaths.length} file{selectedPaths.length !== 1 ? "s" : ""})
            </button>
            <label className="text-xs flex items-center gap-1.5 cursor-pointer text-zinc-400 hover:text-zinc-300">
              <input
                type="checkbox"
                checked={verifyCopy}
                onChange={(e) => setVerifyCopy(e.target.checked)}
                className="size-3.5 rounded border-zinc-600 bg-zinc-800 accent-emerald-600"
              />
              Verify with checksum (BLAKE3)
            </label>
          </div>
        </>
      )}
    </div>
  );
}
