import { useState, useEffect, useCallback } from "react";
import { listHistory } from "@/shared/api";
import type { HistoryPage, SyncHistoryEntry } from "@/entities/music-file";

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const PAGE_SIZE = 20;

const statusColor = (status: string): string => {
  if (status === "Completed") return "var(--color-accent)";
  if (status === "Failed") return "var(--color-danger)";
  return "var(--color-warning)";
};

export function HistoryView() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listHistory(p, PAGE_SIZE);
      setData(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(page);
  }, [page, fetchPage]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="mt-6 p-4 border border-border-subtle rounded-xl bg-surface-1">
      <h3 className="text-base font-semibold mb-3 text-text-primary">Sync History</h3>

      {loading && <p className="text-text-muted text-[13px]">Loading...</p>}
      {error && <p className="text-danger text-[13px]">Error: {error}</p>}

      {data && data.entries.length === 0 && !loading && (
        <p className="text-text-muted text-[13px]">No sync history yet.</p>
      )}

      {data && data.entries.length > 0 && (
        <>
          <div className="overflow-x-auto text-[13px]">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-border text-left">
                  <th className="py-2 px-3 text-text-muted text-xs font-medium uppercase tracking-wide">Date</th>
                  <th className="py-2 px-3 text-text-muted text-xs font-medium uppercase tracking-wide">Source</th>
                  <th className="py-2 px-3 text-text-muted text-xs font-medium uppercase tracking-wide">Destination</th>
                  <th className="py-2 px-3 text-right text-text-muted text-xs font-medium uppercase tracking-wide">Files</th>
                  <th className="py-2 px-3 text-right text-text-muted text-xs font-medium uppercase tracking-wide">Size</th>
                  <th className="py-2 px-3 text-right text-text-muted text-xs font-medium uppercase tracking-wide">Failed</th>
                  <th className="py-2 px-3 text-text-muted text-xs font-medium uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e: SyncHistoryEntry) => (
                  <tr key={e.id} className="border-b border-border-subtle hover:bg-surface-0 transition-colors">
                    <td className="py-2 px-3 whitespace-nowrap text-xs text-text-secondary">
                      {new Date(e.startedAt).toLocaleString()}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] max-w-40 overflow-hidden text-ellipsis text-text-muted">
                      {e.sourceRoot}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] max-w-40 overflow-hidden text-ellipsis text-text-muted">
                      {e.destinationRoot}
                    </td>
                    <td className="py-2 px-3 text-right text-text-primary tabular-nums">
                      {e.filesNew + e.filesUpdated}
                    </td>
                    <td className="py-2 px-3 text-right text-text-primary tabular-nums">
                      {formatSize(e.bytesCopied)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums" style={{ color: e.filesFailed > 0 ? "var(--color-danger)" : "var(--color-text-primary)" }}>
                      {e.filesFailed > 0 ? e.filesFailed : "\u2014"}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        style={{ color: statusColor(e.status) }}
                        className="font-semibold text-[11px]"
                      >
                        {e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2 justify-center mt-3 items-center">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-2.5 py-1 text-xs font-medium border border-border rounded-lg bg-transparent text-text-secondary cursor-pointer transition-colors hover:bg-surface-2 disabled:opacity-30 disabled:cursor-default"
            >
              Previous
            </button>
            <span className="text-xs text-text-muted">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-2.5 py-1 text-xs font-medium border border-border rounded-lg bg-transparent text-text-secondary cursor-pointer transition-colors hover:bg-surface-2 disabled:opacity-30 disabled:cursor-default"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
