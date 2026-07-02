import { useState } from "react";
import { HomePage } from "@/pages/home";

function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    document.getElementById("root")!.classList.contains("dark"),
  );

  const toggle = () => {
    const root = document.getElementById("root")!;
    if (dark) {
      root.classList.remove("dark");
      localStorage.theme = "light";
    } else {
      root.classList.add("dark");
      localStorage.theme = "dark";
    }
    setDark(!dark);
  };

  return (
    <button
      onClick={toggle}
      className="relative w-9 h-5 rounded-full bg-surface-3 transition-colors cursor-pointer hover:bg-border focus:outline-none focus:ring-2 focus:ring-accent/40"
      aria-label="Toggle theme"
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-surface-0 border border-border transition-transform duration-200 ${
          dark ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

export function App() {
  return (
    <div className="min-h-screen flex flex-col bg-surface-0">
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-surface-0/80 backdrop-blur-sm">
        <div className="flex items-center justify-between px-6 h-12">
          <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md overflow-hidden">
            <img src="/icons/icon.png" alt="" className="w-full h-full object-cover" />
          </div>
            <span className="text-sm font-semibold tracking-tight text-text-primary">MusicSync</span>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1">
        <HomePage />
      </main>
    </div>
  );
}
