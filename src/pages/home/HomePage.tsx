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
    <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>MusicSync</h1>
          <p style={{ color: "#666", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
            Compare and sync audio libraries between your local collection and a portable device.
          </p>
        </div>
        <button
          onClick={() => setShowHistory((s) => !s)}
          style={{
            padding: "0.3rem 0.7rem",
            fontSize: "0.8rem",
            border: "1px solid #888",
            borderRadius: 4,
            backgroundColor: "transparent",
            cursor: "pointer",
            marginBottom: "1rem",
          }}
        >
          {showHistory ? "Close history" : "Sync history"}
        </button>
      </div>

      <FolderSelection onCompare={handleCompare} disabled={phase === "scanning"} />

      {showHistory && <HistoryView />}

      {phase === "scanning" && (
        <div style={{ margin: "1rem 0", padding: "1rem", backgroundColor: "#f5f5f5", borderRadius: 6 }}>
          <p style={{ fontWeight: 600 }}>Scanning…</p>
          {progress && (
            <p style={{ fontSize: "0.85rem", color: "#555", marginTop: "0.25rem" }}>
              {progress.filesFound} files found
              {progress.currentPath && (
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                    display: "block",
                    marginTop: "0.25rem",
                    wordBreak: "break-all",
                  }}
                >
                  {progress.currentPath}
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {phase === "error" && (
        <div
          style={{
            margin: "1rem 0",
            padding: "1rem",
            backgroundColor: "#ffebee",
            borderRadius: 6,
            color: "#c62828",
          }}
        >
          <p style={{ fontWeight: 600 }}>Error</p>
          <p style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>{error}</p>
        </div>
      )}

      {(copyRunning || copyDone || copyError) && (
        <>
          {unmountMsg && (
            <div
              style={{
                margin: "1rem 0",
                padding: "0.75rem 1rem",
                backgroundColor: "#fff3e0",
                border: "1px solid #ffb74d",
                borderRadius: 6,
                color: "#e65100",
                fontSize: "0.85rem",
              }}
            >
              {unmountMsg}
            </div>
          )}
          <CopyProgressView />
        </>
      )}

      {result && !copyRunning && !copyDone && (
        <>
          <ComparisonView result={result} />
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={handleCopy}
              disabled={selectedPaths.length === 0}
              style={{
                padding: "0.5rem 1.2rem",
                fontSize: "0.9rem",
                fontWeight: 600,
                border: "none",
                borderRadius: 4,
                backgroundColor: selectedPaths.length === 0 ? "#ccc" : "#2e7d32",
                color: "#fff",
                cursor: selectedPaths.length === 0 ? "default" : "pointer",
              }}
            >
              Copy selected ({selectedPaths.length} file{selectedPaths.length !== 1 ? "s" : ""})
            </button>
            <label style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={verifyCopy}
                onChange={(e) => setVerifyCopy(e.target.checked)}
              />
              Verify with checksum (BLAKE3)
            </label>
          </div>
        </>
      )}
    </div>
  );
}
