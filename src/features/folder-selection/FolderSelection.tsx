import { useState } from "react";

interface FolderSelectionProps {
  onCompare: (source: string, dest: string, level: string) => void;
  disabled: boolean;
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
    <div className="mb-6 p-5 bg-zinc-900 rounded-lg border border-zinc-800">
      <div className="mb-4">
        <label className="block mb-1.5 text-sm font-medium text-zinc-300">
          Source folder
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={source}
            readOnly
            placeholder="Select source folder..."
            className="flex-1 px-3 py-2 rounded-md bg-zinc-950 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-600"
          />
          <button
            onClick={handleSource}
            disabled={disabled}
            className="px-3 py-2 text-sm border border-zinc-700 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
          >
            Browse…
          </button>
        </div>
      </div>

      <div className="mb-4">
        <label className="block mb-1.5 text-sm font-medium text-zinc-300">
          Destination folder
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={dest}
            readOnly
            placeholder="Select destination folder..."
            className="flex-1 px-3 py-2 rounded-md bg-zinc-950 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-600"
          />
          <button
            onClick={handleDest}
            disabled={disabled}
            className="px-3 py-2 text-sm border border-zinc-700 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
          >
            Browse…
          </button>
        </div>
      </div>

      <div className="mb-4">
        <label className="block mb-1.5 text-sm font-medium text-zinc-300">
          Comparison level
        </label>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          disabled={disabled}
          className="px-3 py-2 rounded-md bg-zinc-950 border border-zinc-700 text-sm text-zinc-200"
        >
          <option value="Fast">Fast (path only)</option>
          <option value="Metadata">Metadata (size + mtime)</option>
          <option value="Strict">Strict (hash) — coming soon</option>
        </select>
      </div>

      <button
        onClick={() => onCompare(source, dest, level)}
        disabled={disabled || !source || !dest}
        className="px-5 py-2 text-sm font-semibold rounded-md bg-zinc-100 text-zinc-900 hover:bg-white cursor-pointer transition-colors disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed"
      >
        Compare
      </button>
    </div>
  );
}
