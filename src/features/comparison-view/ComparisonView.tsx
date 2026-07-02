import { useCallback, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import type { ComparisonResult, DiffStatus, ComparisonEntry } from "@/entities/music-file";
import { useAppStore } from "@/shared/store";
import { formatSize } from "@/shared/format-size";

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

const SPACE_CHECK_DEBOUNCE_MS = 300;

export function ComparisonSummary({ result }: { result: ComparisonResult }) {
  const { stats } = result;
  const selectOnly = useAppStore((s) => s.selectOnly);
  const deselectAll = useAppStore((s) => s.deselectAll);
  const hasSelection = useAppStore((s) => s.selectedPaths.length > 0);

  const handleSelectByStatus = useCallback(
    (status: DiffStatus) => {
      const paths = result.entries
        .filter((e) => e.status === status)
        .map((e) => e.relativePath);
      selectOnly(paths);
    },
    [result.entries, selectOnly],
  );

  return (
    <div style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <StatCard label="New" count={stats.totalNew} size={stats.totalSizeNew} color="#2e7d32" />
        <StatCard label="Different" count={stats.totalDifferent} size={stats.totalSizeDifferent} color="#c62828" />
        <StatCard label="Orphan" count={stats.totalOrphan} color="#e65100" />
        <StatCard label="Identical" count={stats.totalIdentical} color="#666" />
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
        <SmallButton onClick={() => handleSelectByStatus("New")} color="#2e7d32">
          Select all New
        </SmallButton>
        <SmallButton onClick={() => handleSelectByStatus("Different")} color="#c62828">
          Select all Different
        </SmallButton>
        <SmallButton onClick={() => selectOnly(result.entries.map((e) => e.relativePath))}>
          Select all
        </SmallButton>
        <SmallButton onClick={deselectAll} disabled={!hasSelection}>
          Deselect all
        </SmallButton>
      </div>
    </div>
  );
}

function SmallButton({
  children,
  onClick,
  color,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "0.25rem 0.6rem",
        fontSize: "0.8rem",
        border: `1px solid ${color ?? "#888"}`,
        borderRadius: 4,
        backgroundColor: "transparent",
        color: color ?? "#333",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
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

export function ComparisonEntryRow({
  entry,
  selected,
  onToggle,
}: {
  entry: ComparisonEntry;
  selected: boolean;
  onToggle: (path: string) => void;
}) {
  const srcSize = entry.source?.sizeBytes;
  const dstSize = entry.destination?.sizeBytes;
  return (
    <tr>
      <td style={{ padding: "0.3rem 0.5rem" }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(entry.relativePath)}
          aria-label={`Select ${entry.relativePath}`}
        />
      </td>
      <td style={{ padding: "0.3rem 0.5rem" }}>
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
      <td style={{ fontFamily: "monospace", fontSize: "0.85rem", padding: "0.3rem 0.5rem" }}>{entry.relativePath}</td>
      <td style={{ textAlign: "right", padding: "0.3rem 0.5rem" }}>{srcSize !== undefined ? formatSize(srcSize) : "—"}</td>
      <td style={{ textAlign: "right", padding: "0.3rem 0.5rem" }}>{dstSize !== undefined ? formatSize(dstSize) : "—"}</td>
    </tr>
  );
}

export function ComparisonList({
  result,
  selectedPaths,
  onToggle,
}: {
  result: ComparisonResult;
  selectedPaths: string[];
  onToggle: (path: string) => void;
}) {
  if (result.entries.length === 0) {
    return <p style={{ color: "#666" }}>No files found.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #ddd", textAlign: "left" }}>
            <th style={{ padding: "0.4rem 0.5rem", width: 32 }}></th>
            <th style={{ padding: "0.4rem 0.5rem" }}>Status</th>
            <th style={{ padding: "0.4rem 0.5rem" }}>Path</th>
            <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>Source size</th>
            <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>Dest size</th>
          </tr>
        </thead>
        <tbody>
          {result.entries.map((entry) => (
            <ComparisonEntryRow
              key={entry.relativePath}
              entry={entry}
              selected={selectedPaths.includes(entry.relativePath)}
              onToggle={onToggle}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SelectionPanel({ result }: { result: ComparisonResult }) {
  const selectedPaths = useAppStore((s) => s.selectedPaths);
  const spaceInfo = useAppStore((s) => s.spaceInfo);
  const spaceLoading = useAppStore((s) => s.spaceLoading);
  const spaceError = useAppStore((s) => s.spaceError);
  const fetchSpaceInfo = useAppStore((s) => s.fetchSpaceInfo);

  const entryMap = useMemo(
    () => new Map(result.entries.map((e) => [e.relativePath, e])),
    [result.entries],
  );

  const { selectedCount, selectedSize } = useMemo(() => {
    let count = 0;
    let size = 0;
    for (const path of selectedPaths) {
      const entry = entryMap.get(path);
      if (entry?.source) {
        count++;
        size += entry.source.sizeBytes;
      }
    }
    return { selectedCount: count, selectedSize: size };
  }, [selectedPaths, entryMap]);

  useEffect(() => {
    if (selectedPaths.length === 0) return;
    const timer = setTimeout(() => {
      const absPaths: string[] = [];
      for (const path of selectedPaths) {
        const entry = entryMap.get(path);
        if (entry?.source) absPaths.push(entry.source.absolutePath);
      }
      if (absPaths.length > 0) {
        fetchSpaceInfo(result.destinationRoot, absPaths);
      }
    }, SPACE_CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [selectedPaths, result.destinationRoot, fetchSpaceInfo, entryMap]);

  if (selectedCount === 0) {
    return null;
  }

  const freeSpace = spaceInfo?.freeSpaceOnDestination ?? null;
  const isWarning = freeSpace !== null && selectedSize > freeSpace;

  return (
    <div
      style={{
        marginTop: "1rem",
        padding: "0.75rem",
        border: "1px solid #ccc",
        borderRadius: 6,
        backgroundColor: "#fafafa",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
        Selected: {selectedCount} file{selectedCount !== 1 ? "s" : ""} &middot; {formatSize(selectedSize)}
      </div>
      {spaceLoading && <div style={{ fontSize: "0.85rem", color: "#888" }}>Checking free space…</div>}
      {spaceError && <div style={{ fontSize: "0.85rem", color: "#c62828" }}>Error: {spaceError}</div>}
      {freeSpace !== null && !spaceLoading && (
        <>
          <div style={{ fontSize: "0.85rem", color: "#555" }}>
            Free on destination: {formatSize(freeSpace)}
          </div>
          <div
            style={{
              height: 8,
              backgroundColor: "#e0e0e0",
              borderRadius: 4,
              marginTop: "0.25rem",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.min((selectedSize / freeSpace) * 100, 100)}%`,
                backgroundColor: isWarning ? "#c62828" : "#2e7d32",
                borderRadius: 4,
                transition: "width 0.3s ease",
              }}
            />
          </div>
          {isWarning && (
            <div style={{ color: "#c62828", fontWeight: 600, fontSize: "0.85rem", marginTop: "0.15rem" }}>
              Not enough free space! Need {formatSize(selectedSize)} but only {formatSize(freeSpace)} available.
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ComparisonView({ result }: { result: ComparisonResult }) {
  const selectedPaths = useAppStore((s) => s.selectedPaths);
  const toggleSelect = useAppStore((s) => s.toggleSelect);

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
      <ComparisonList result={result} selectedPaths={selectedPaths} onToggle={toggleSelect} />
      <SelectionPanel result={result} />
    </div>
  );
}
