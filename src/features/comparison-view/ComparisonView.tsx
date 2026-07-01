import type { ComparisonResult, DiffStatus, ComparisonEntry } from "@/entities/music-file";

interface ComparisonViewProps {
  result: ComparisonResult;
}

const STATUS_LABEL: Record<DiffStatus, string> = {
  New: "New",
  Orphan: "Orphan",
  Identical: "Identical",
  Different: "Different",
};

const STATUS_COLOR: Record<DiffStatus, string> = {
  New: "#2e7d32",
  Orphan: "#e65100",
  Identical: "#666",
  Different: "#c62828",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ComparisonSummary({ result }: { result: ComparisonResult }) {
  const { stats } = result;
  return (
    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
      <StatCard label="New" count={stats.totalNew} size={stats.totalSizeNew} color="#2e7d32" />
      <StatCard label="Different" count={stats.totalDifferent} size={stats.totalSizeDifferent} color="#c62828" />
      <StatCard label="Orphan" count={stats.totalOrphan} color="#e65100" />
      <StatCard label="Identical" count={stats.totalIdentical} color="#666" />
    </div>
  );
}

function StatCard({ label, count, size, color }: { label: string; count: number; size?: number; color: string }) {
  return (
    <div
      style={{
        padding: "0.75rem",
        borderRadius: 6,
        border: `1px solid ${color}`,
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color }}>{count}</div>
      <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>{label}</div>
      {size !== undefined && count > 0 && (
        <div style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>{formatSize(size)}</div>
      )}
    </div>
  );
}

export function ComparisonEntryRow({ entry }: { entry: ComparisonEntry }) {
  const srcSize = entry.source?.sizeBytes;
  const dstSize = entry.destination?.sizeBytes;
  return (
    <tr>
      <td>
        <span
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: STATUS_COLOR[entry.status],
            marginRight: "0.5rem",
          }}
        />
        {STATUS_LABEL[entry.status]}
      </td>
      <td style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{entry.relativePath}</td>
      <td style={{ textAlign: "right" }}>{srcSize !== undefined ? formatSize(srcSize) : "—"}</td>
      <td style={{ textAlign: "right" }}>{dstSize !== undefined ? formatSize(dstSize) : "—"}</td>
    </tr>
  );
}

export function ComparisonList({ result }: ComparisonViewProps) {
  if (result.entries.length === 0) {
    return <p style={{ color: "#666" }}>No files found.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #ddd", textAlign: "left" }}>
            <th style={{ padding: "0.4rem 0.5rem" }}>Status</th>
            <th style={{ padding: "0.4rem 0.5rem" }}>Path</th>
            <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>Source size</th>
            <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>Dest size</th>
          </tr>
        </thead>
        <tbody>
          {result.entries.map((entry) => (
            <ComparisonEntryRow key={entry.relativePath} entry={entry} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ComparisonView({ result }: ComparisonViewProps) {
  return (
    <div>
      <h3 style={{ marginBottom: "0.5rem" }}>
        Comparison results —
        <span style={{ fontWeight: 400, marginLeft: "0.25rem" }}>
          {result.comparisonLevel} level
        </span>
      </h3>
      <p style={{ fontSize: "0.8rem", color: "#888", marginBottom: "0.75rem" }}>
        Source: {result.sourceRoot} &nbsp;|&nbsp; Destination: {result.destinationRoot}
      </p>
      <ComparisonSummary result={result} />
      <ComparisonList result={result} />
    </div>
  );
}
