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
  New: "#22c55e",
  Orphan: "#f59e0b",
  Identical: "#71717a",
  Different: "#ef4444",
};

const STATUS_BG: Record<DiffStatus, string> = {
  New: "border-emerald-500",
  Orphan: "border-amber-500",
  Identical: "border-zinc-500",
  Different: "border-red-500",
};

const STATUS_TEXT: Record<DiffStatus, string> = {
  New: "text-emerald-400",
  Orphan: "text-amber-400",
  Identical: "text-zinc-400",
  Different: "text-red-400",
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
    <div className="mb-4">
      <div className="flex gap-3 flex-wrap">
        <StatCard label="New" count={stats.totalNew} size={stats.totalSizeNew} status="New" />
        <StatCard label="Different" count={stats.totalDifferent} size={stats.totalSizeDifferent} status="Different" />
        <StatCard label="Orphan" count={stats.totalOrphan} status="Orphan" />
        <StatCard label="Identical" count={stats.totalIdentical} status="Identical" />
      </div>
      <div className="flex gap-2 mt-3 flex-wrap">
        <SmallButton onClick={() => handleSelectByStatus("New")} colorClass="border-emerald-600 text-emerald-400 hover:bg-emerald-950/30">
          Select all New
        </SmallButton>
        <SmallButton onClick={() => handleSelectByStatus("Different")} colorClass="border-red-600 text-red-400 hover:bg-red-950/30">
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
  colorClass,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  colorClass?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-2.5 py-1 text-xs border rounded-md bg-transparent cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-default ${
        colorClass ?? "border-zinc-600 text-zinc-300 hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

function StatCard({ label, count, size, status }: { label: string; count: number; size?: number; status: DiffStatus }) {
  return (
    <div className={`px-3 py-2.5 rounded-lg border ${STATUS_BG[status]} min-w-[120px]`}>
      <div className={`text-2xl font-bold ${STATUS_TEXT[status]}`}>{count}</div>
      <div className="text-xs font-semibold text-zinc-300">{label}</div>
      {size !== undefined && count > 0 && (
        <div className="text-[11px] text-zinc-500 mt-0.5">{formatSize(size)}</div>
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
    <tr className="border-b border-zinc-800">
      <td className="py-1.5 px-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(entry.relativePath)}
          aria-label={`Select ${entry.relativePath}`}
          className="size-3.5 rounded border-zinc-600 bg-zinc-800 accent-emerald-600"
        />
      </td>
      <td className="py-1.5 px-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full mr-2"
          style={{ backgroundColor: STATUS_COLOR[entry.status] }}
        />
        {STATUS_LABEL[entry.status]}
      </td>
      <td className="font-mono text-[13px] py-1.5 px-2 text-zinc-300">{entry.relativePath}</td>
      <td className="text-right py-1.5 px-2 text-zinc-400 text-sm">{srcSize !== undefined ? formatSize(srcSize) : "\u2014"}</td>
      <td className="text-right py-1.5 px-2 text-zinc-400 text-sm">{dstSize !== undefined ? formatSize(dstSize) : "\u2014"}</td>
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
    return <p className="text-zinc-400 text-sm">No files found.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-zinc-700 text-left">
            <th className="py-2 px-2 w-8"></th>
            <th className="py-2 px-2 text-zinc-400 text-xs font-medium">Status</th>
            <th className="py-2 px-2 text-zinc-400 text-xs font-medium">Path</th>
            <th className="py-2 px-2 text-right text-zinc-400 text-xs font-medium">Source size</th>
            <th className="py-2 px-2 text-right text-zinc-400 text-xs font-medium">Dest size</th>
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
    <div className="mt-4 p-3 border border-zinc-700 rounded-lg bg-zinc-900/50">
      <div className="font-semibold text-sm mb-1 text-zinc-200">
        Selected: {selectedCount} file{selectedCount !== 1 ? "s" : ""} &middot; {formatSize(selectedSize)}
      </div>
      {spaceLoading && <div className="text-[13px] text-zinc-500">Checking free space...</div>}
      {spaceError && <div className="text-[13px] text-red-400">Error: {spaceError}</div>}
      {freeSpace !== null && !spaceLoading && (
        <>
          <div className="text-[13px] text-zinc-400">
            Free on destination: {formatSize(freeSpace)}
          </div>
          <div className="h-2 bg-zinc-700 rounded-full mt-1 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.min((selectedSize / freeSpace) * 100, 100)}%`,
                backgroundColor: isWarning ? "#ef4444" : "#22c55e",
              }}
            />
          </div>
          {isWarning && (
            <div className="text-red-400 font-semibold text-[13px] mt-0.5">
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
      <h3 className="text-lg font-semibold mb-1 text-zinc-100">
        Comparison results{" "}
        <span className="font-normal text-zinc-400 ml-1">
          {result.comparisonLevel} level
        </span>
      </h3>
      <p className="text-xs text-zinc-500 mb-3 font-mono">
        Source: {result.sourceRoot} &nbsp;|&nbsp; Destination: {result.destinationRoot}
      </p>
      <ComparisonSummary result={result} />
      <ComparisonList result={result} selectedPaths={selectedPaths} onToggle={toggleSelect} />
      <SelectionPanel result={result} />
    </div>
  );
}
