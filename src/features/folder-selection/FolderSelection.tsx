import { useState, useRef, useEffect } from "react";

interface FolderSelectionProps {
  onCompare: (source: string, dest: string, level: string) => void;
  disabled: boolean;
}

const LEVELS = [
  { value: "Fast", label: "Fast", description: "Compare file paths only" },
  { value: "Metadata", label: "Metadata", description: "Size + modification time" },
  { value: "Strict", label: "Strict", description: "Full content hash (coming soon)" },
] as const;

function CompareDropdown({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LEVELS.find((l) => l.value === value)!;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative w-52">
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-surface-0 border border-border text-sm text-text-primary cursor-pointer hover:border-border/80 transition-colors disabled:opacity-40 disabled:cursor-default"
      >
        <span>{current.label}</span>
        <svg
          className={`w-4 h-4 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-full bg-surface-0 border border-border rounded-lg shadow-lg overflow-hidden">
          {LEVELS.map((level) => (
            <button
              key={level.value}
              type="button"
              onClick={() => {
                onChange(level.value);
                setOpen(false);
              }}
              className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
                level.value === value
                  ? "bg-surface-2"
                  : "hover:bg-surface-1"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-primary flex items-center gap-1.5">
                  {level.label}
                  {level.value === "Strict" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-3 text-text-muted font-medium">
                      Soon
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-muted mt-0.5">{level.description}</div>
              </div>
              {level.value === value && (
                <svg className="w-4 h-4 text-accent shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderSelection({ onCompare, disabled }: FolderSelectionProps) {
  const [source, setSource] = useState("");
  const [dest, setDest] = useState("");
  const [level, setLevel] = useState("Metadata");

  const pickFolder = async (): Promise<string | null> => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Select folder" });
      return selected as string | null;
    } catch {
      return null;
    }
  };

  const handleSource = async () => {
    const path = await pickFolder();
    if (path) setSource(path);
  };

  const handleDest = async () => {
    const path = await pickFolder();
    if (path) setDest(path);
  };

  return (
    <div className="p-4 bg-surface-1 rounded-xl border border-border-subtle">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block mb-1.5 text-xs font-medium text-text-secondary uppercase tracking-wide">
            Source folder
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={source}
              readOnly
              placeholder="Select source folder..."
              className="flex-1 px-3 py-2 rounded-lg bg-surface-0 border border-border text-sm text-text-primary placeholder-text-muted"
            />
            <button
              onClick={handleSource}
              disabled={disabled}
              className="px-3 py-2 text-sm font-medium border border-border rounded-lg bg-surface-2 text-text-secondary hover:bg-surface-3 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
            >
              Browse
            </button>
          </div>
        </div>

        <div>
          <label className="block mb-1.5 text-xs font-medium text-text-secondary uppercase tracking-wide">
            Destination folder
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={dest}
              readOnly
              placeholder="Select destination folder..."
              className="flex-1 px-3 py-2 rounded-lg bg-surface-0 border border-border text-sm text-text-primary placeholder-text-muted"
            />
            <button
              onClick={handleDest}
              disabled={disabled}
              className="px-3 py-2 text-sm font-medium border border-border rounded-lg bg-surface-2 text-text-secondary hover:bg-surface-3 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
            >
              Browse
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-end gap-3 mt-4">
        <div>
          <label className="block mb-1.5 text-xs font-medium text-text-secondary uppercase tracking-wide">
            Comparison level
          </label>
          <CompareDropdown value={level} onChange={setLevel} disabled={disabled} />
        </div>

        <button
          onClick={() => onCompare(source, dest, level)}
          disabled={disabled || !source || !dest}
          className="px-5 py-2 text-sm font-medium rounded-lg bg-text-primary text-surface-0 hover:opacity-90 cursor-pointer transition-opacity disabled:bg-surface-3 disabled:text-text-muted disabled:cursor-not-allowed"
        >
          Compare
        </button>
      </div>
    </div>
  );
}
