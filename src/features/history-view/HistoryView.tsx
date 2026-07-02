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
  if (status === "Completed") return "#22c55e";
  if (status === "Failed") return "#ef4444";
  return "#f59e0b";
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
    <div className="mt-6 p-4 border border-zinc-700 rounded-lg bg-zinc-900/50">
      <h3 className="text-base font-semibold mb-3 text-zinc-100">Sync History</h3>

      {loading && <p className="text-zinc-500 text-[13px]">Loading…</p>}
      {error && <p className="text-red-400 text-[13px]">Error: {error}</p>}

      {data && data.entries.length === 0 && !loading && (
        <p className="text-zinc-500 text-[13px]">No sync history yet.</p>
      )}

      {data && data.entries.length > 0 && (
        <>
          <div className="overflow-x-auto text-[13px]">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-zinc-700 text-left">
                  <th className="py-1.5 px-2 text-zinc-400 text-xs font-medium">Date</th>
                  <th className="py-1.5 px-2 text-zinc-400 text-xs font-medium">Source</th>
                  <th className="py-1.5 px-2 text-zinc-400 text-xs font-medium">Destination</th>
                  <th className="py-1.5 px-2 text-right text-zinc-400 text-xs font-medium">Files</th>
                  <th className="py-1.5 px-2 text-right text-zinc-400 text-xs font-medium">Size</th>
                  <th className="py-1.5 px-2 text-right text-zinc-400 text-xs font-medium">Failed</th>
                  <th className="py-1.5 px-2 text-zinc-400 text-xs font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e: SyncHistoryEntry) => (
                  <tr key={e.id} className="border-b border-zinc-800">
                    <td className="py-1.5 px-2 whitespace-nowrap text-xs text-zinc-400">
                      {new Date(e.startedAt).toLocaleString()}
                    </td>
                    <td className="py-1.5 px-2 font-mono text-[11px] max-w-40 overflow-hidden text-ellipsis text-zinc-500">
                      {e.sourceRoot}
                    </td>
                    <td className="py-1.5 px-2 font-mono text-[11px] max-w-40 overflow-hidden text-ellipsis text-zinc-500">
                      {e.destinationRoot}
                    </td>
                    <td className="py-1.5 px-2 text-right text-zinc-300">
                      {e.filesNew + e.filesUpdated}
                    </td>
                    <td className="py-1.5 px-2 text-right text-zinc-300">
                      {formatSize(e.bytesCopied)}
                    </td>
                    <td className="py-1.5 px-2 text-right text-zinc-300" style={{ color: e.filesFailed > 0 ? "#ef4444" : undefined }}>
                      {e.filesFailed > 0 ? e.filesFailed : "\u2014"}
                    </td>
                    <td className="py-1.5 px-2">
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
              className="px-2.5 py-1 text-xs border border-zinc-600 rounded-md bg-transparent text-zinc-300 cursor-pointer transition-colors hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-default"
            >
              Previous
            </button>
            <span className="text-xs text-zinc-500">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-2.5 py-1 text-xs border border-zinc-600 rounded-md bg-transparent text-zinc-300 cursor-pointer transition-colors hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-default"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
