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
    <div style={{ marginTop: "1rem" }}>
      <h3 style={{ margin: "0 0 0.75rem" }}>Sync History</h3>

      {loading && <p style={{ color: "#888", fontSize: "0.85rem" }}>Loading…</p>}
      {error && <p style={{ color: "#c62828", fontSize: "0.85rem" }}>Error: {error}</p>}

      {data && data.entries.length === 0 && !loading && (
        <p style={{ color: "#888", fontSize: "0.85rem" }}>No sync history yet.</p>
      )}

      {data && data.entries.length > 0 && (
        <>
          <div style={{ overflowX: "auto", fontSize: "0.85rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd", textAlign: "left" }}>
                  <th style={{ padding: "0.3rem 0.5rem" }}>Date</th>
                  <th style={{ padding: "0.3rem 0.5rem" }}>Source</th>
                  <th style={{ padding: "0.3rem 0.5rem" }}>Destination</th>
                  <th style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>Files</th>
                  <th style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>Size</th>
                  <th style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>Failed</th>
                  <th style={{ padding: "0.3rem 0.5rem" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e: SyncHistoryEntry) => (
                  <tr key={e.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "0.3rem 0.5rem", whiteSpace: "nowrap", fontSize: "0.8rem" }}>
                      {new Date(e.startedAt).toLocaleString()}
                    </td>
                    <td style={{ padding: "0.3rem 0.5rem", fontFamily: "monospace", fontSize: "0.75rem", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {e.sourceRoot}
                    </td>
                    <td style={{ padding: "0.3rem 0.5rem", fontFamily: "monospace", fontSize: "0.75rem", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {e.destinationRoot}
                    </td>
                    <td style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>
                      {e.filesNew + e.filesUpdated}
                    </td>
                    <td style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>
                      {formatSize(e.bytesCopied)}
                    </td>
                    <td style={{ padding: "0.3rem 0.5rem", textAlign: "right", color: e.filesFailed > 0 ? "#c62828" : "inherit" }}>
                      {e.filesFailed > 0 ? e.filesFailed : "—"}
                    </td>
                    <td style={{ padding: "0.3rem 0.5rem" }}>
                      <span
                        style={{
                          color: e.status === "Completed" ? "#2e7d32" : e.status === "Failed" ? "#c62828" : "#e65100",
                          fontWeight: 600,
                          fontSize: "0.75rem",
                        }}
                      >
                        {e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "0.75rem", alignItems: "center" }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              style={{
                padding: "0.25rem 0.6rem",
                fontSize: "0.8rem",
                border: "1px solid #888",
                borderRadius: 4,
                backgroundColor: "transparent",
                cursor: page <= 1 ? "default" : "pointer",
                opacity: page <= 1 ? 0.4 : 1,
              }}
            >
              Previous
            </button>
            <span style={{ fontSize: "0.8rem", color: "#555" }}>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              style={{
                padding: "0.25rem 0.6rem",
                fontSize: "0.8rem",
                border: "1px solid #888",
                borderRadius: 4,
                backgroundColor: "transparent",
                cursor: page >= totalPages ? "default" : "pointer",
                opacity: page >= totalPages ? 0.4 : 1,
              }}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
