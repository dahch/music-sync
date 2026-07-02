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

const STATUS_DOT: Record<DiffStatus, string> = {
  New: "bg-emerald-500",
  Orphan: "bg-amber-500",
  Identical: "bg-zinc-400 dark:bg-zinc-500",
  Different: "bg-red-500",
};

const STATUS_TEXT: Record<DiffStatus, string> = {
  New: "text-emerald-600 dark:text-emerald-400",
  Orphan: "text-amber-600 dark:text-amber-400",
  Identical: "text-zinc-500 dark:text-zinc-400",
  Different: "text-red-600 dark:text-red-400",
};

const STATUS_BG: Record<DiffStatus, string> = {
  New: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800",
  Orphan: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
  Identical: "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800",
  Different: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",
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
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="New" count={stats.totalNew} size={stats.totalSizeNew} status="New" />
        <StatCard label="Different" count={stats.totalDifferent} size={stats.totalSizeDifferent} status="Different" />
        <StatCard label="Orphan" count={stats.totalOrphan} status="Orphan" />
        <StatCard label="Identical" count={stats.totalIdentical} status="Identical" />
      </div>
      <div className="flex gap-2 mt-3 flex-wrap">
        <PillButton onClick={() => handleSelectByStatus("New")} className="border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30">
          Select all New
        </PillButton>
        <PillButton onClick={() => handleSelectByStatus("Different")} className="border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30">
          Select all Different
        </PillButton>
        <PillButton onClick={() => selectOnly(result.entries.map((e) => e.relativePath))}>
          Select all
        </PillButton>
        <PillButton onClick={deselectAll} disabled={!hasSelection}>
          Deselect all
        </PillButton>
      </div>
    </div>
  );
}

function PillButton({
  children,
  onClick,
  className,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-2.5 py-1 text-xs font-medium border rounded-lg bg-transparent cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-default ${
        className ?? "border-border text-text-secondary hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

function StatCard({ label, count, size, status }: { label: string; count: number; size?: number; status: DiffStatus }) {
  return (
    <div className={`px-3 py-2.5 rounded-xl border ${STATUS_BG[status]}`}>
      <div className={`text-2xl font-bold tabular-nums ${STATUS_TEXT[status]}`}>{count}</div>
      <div className="text-xs font-medium text-text-secondary">{label}</div>
      {size !== undefined && count > 0 && (
        <div className="text-[11px] text-text-muted mt-0.5">{formatSize(size)}</div>
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
    <tr className="border-b border-border-subtle hover:bg-surface-1 transition-colors">
      <td className="py-2 px-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(entry.relativePath)}
          aria-label={`Select ${entry.relativePath}`}
          className="size-3.5 rounded border-border bg-surface-0 accent-accent"
        />
      </td>
      <td className="py-2 px-3">
        <span className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[entry.status]}`} />
          <span className={`text-xs font-medium ${STATUS_TEXT[entry.status]}`}>{STATUS_LABEL[entry.status]}</span>
        </span>
      </td>
      <td className="font-mono text-[13px] py-2 px-3 text-text-primary">{entry.relativePath}</td>
      <td className="text-right py-2 px-3 text-text-secondary text-sm tabular-nums">{srcSize !== undefined ? formatSize(srcSize) : "\u2014"}</td>
      <td className="text-right py-2 px-3 text-text-secondary text-sm tabular-nums">{dstSize !== undefined ? formatSize(dstSize) : "\u2014"}</td>
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
    return <p className="text-text-muted text-sm py-4">No files found.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-border text-left">
            <th className="py-2 px-3 w-8"></th>
            <th className="py-2 px-3 text-text-muted text-xs font-medium uppercase tracking-wide">Status</th>
            <th className="py-2 px-3 text-text-muted text-xs font-medium uppercase tracking-wide">Path</th>
            <th className="py-2 px-3 text-right text-text-muted text-xs font-medium uppercase tracking-wide">Source</th>
            <th className="py-2 px-3 text-right text-text-muted text-xs font-medium uppercase tracking-wide">Dest</th>
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
    <div className="mt-4 p-3 border border-border-subtle rounded-xl bg-surface-1">
      <div className="font-medium text-sm text-text-primary">
        {selectedCount} file{selectedCount !== 1 ? "s" : ""} selected &middot; {formatSize(selectedSize)}
      </div>
      {spaceLoading && <div className="text-[13px] text-text-muted mt-1">Checking free space...</div>}
      {spaceError && <div className="text-[13px] text-danger mt-1">Error: {spaceError}</div>}
      {freeSpace !== null && !spaceLoading && (
        <div className="mt-2">
          <div className="text-[13px] text-text-secondary">
            Free on destination: {formatSize(freeSpace)}
          </div>
          <div className="h-1.5 bg-surface-3 rounded-full mt-1.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.min((selectedSize / freeSpace) * 100, 100)}%`,
                backgroundColor: isWarning ? "var(--color-danger)" : "var(--color-accent)",
              }}
            />
          </div>
          {isWarning && (
            <div className="text-danger font-medium text-[13px] mt-1">
              Not enough free space! Need {formatSize(selectedSize)} but only {formatSize(freeSpace)} available.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ComparisonView({ result }: { result: ComparisonResult }) {
  const selectedPaths = useAppStore((s) => s.selectedPaths);
  const toggleSelect = useAppStore((s) => s.toggleSelect);

  return (
    <div className="mt-4">
      <h3 className="text-base font-semibold text-text-primary">
        Results
        <span className="font-normal text-text-secondary ml-2 text-sm">
          {result.comparisonLevel} level
        </span>
      </h3>
      <p className="text-xs text-text-muted mb-3 font-mono">
        Source: {result.sourceRoot} &nbsp;|&nbsp; Destination: {result.destinationRoot}
      </p>
      <ComparisonSummary result={result} />
      <ComparisonList result={result} selectedPaths={selectedPaths} onToggle={toggleSelect} />
      <SelectionPanel result={result} />
    </div>
  );
}
