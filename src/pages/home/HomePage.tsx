import { useState, useCallback } from "react";
import { FolderSelection } from "@/features/folder-selection";
import { ComparisonView } from "@/features/comparison-view";
import { scanAndCompare, onScanProgress } from "@/shared/api";
import type { ComparisonResult, ScanProgress } from "@/shared/api";

type Phase = "idle" | "scanning" | "done" | "error";

export function HomePage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCompare = useCallback(async (source: string, dest: string, level: string) => {
    setPhase("scanning");
    setProgress(null);
    setResult(null);
    setError(null);

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
  }, []);

  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ marginBottom: "0.25rem" }}>MusicSync</h1>
      <p style={{ color: "#666", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
        Compare and sync audio libraries between your local collection and a portable device.
      </p>

      <FolderSelection onCompare={handleCompare} disabled={phase === "scanning"} />

      {phase === "scanning" && (
        <div style={{ margin: "1rem 0", padding: "1rem", backgroundColor: "#f5f5f5", borderRadius: 6 }}>
          <p style={{ fontWeight: 600 }}>Scanning…</p>
          {progress && (
            <p style={{ fontSize: "0.85rem", color: "#555", marginTop: "0.25rem" }}>
              {progress.filesFound} files found
              {progress.currentPath && (
                <span style={{ fontFamily: "monospace", fontSize: "0.8rem", display: "block", marginTop: "0.25rem", wordBreak: "break-all" }}>
                  {progress.currentPath}
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {phase === "error" && (
        <div style={{ margin: "1rem 0", padding: "1rem", backgroundColor: "#ffebee", borderRadius: 6, color: "#c62828" }}>
          <p style={{ fontWeight: 600 }}>Error</p>
          <p style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>{error}</p>
        </div>
      )}

      {result && <ComparisonView result={result} />}
    </div>
  );
}
