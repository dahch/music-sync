import { useAppStore } from "@/shared/store";

export function HomePage() {
  const count = useAppStore((s) => s.count);
  const increment = useAppStore((s) => s.increment);

  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>MusicSync — scaffolding OK</h1>
      <p>Counter: {count}</p>
      <button onClick={increment}>+1</button>
    </div>
  );
}
