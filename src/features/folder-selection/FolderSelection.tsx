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
    <div style={{ marginBottom: "1rem" }}>
      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
          Source folder
        </label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type="text"
            value={source}
            readOnly
            placeholder="Select source folder..."
            style={{ flex: 1, padding: "0.4rem", borderRadius: 4, border: "1px solid #ccc" }}
          />
          <button onClick={handleSource} disabled={disabled}>
            Browse…
          </button>
        </div>
      </div>

      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
          Destination folder
        </label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type="text"
            value={dest}
            readOnly
            placeholder="Select destination folder..."
            style={{ flex: 1, padding: "0.4rem", borderRadius: 4, border: "1px solid #ccc" }}
          />
          <button onClick={handleDest} disabled={disabled}>
            Browse…
          </button>
        </div>
      </div>

      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
          Comparison level
        </label>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          disabled={disabled}
          style={{ padding: "0.4rem", borderRadius: 4, border: "1px solid #ccc" }}
        >
          <option value="Fast">Fast (path only)</option>
          <option value="Metadata">Metadata (size + mtime)</option>
          <option value="Strict">Strict (hash) — coming soon</option>
        </select>
      </div>

      <button
        onClick={() => onCompare(source, dest, level)}
        disabled={disabled || !source || !dest}
        style={{
          padding: "0.5rem 1.5rem",
          fontWeight: 600,
          cursor: disabled || !source || !dest ? "not-allowed" : "pointer",
        }}
      >
        Compare
      </button>
    </div>
  );
}
