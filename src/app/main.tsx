import React from "react";
import ReactDOM from "react-dom/client";
import "../index.css";
import { App } from "./App";

const root = document.getElementById("root")!;

if (
  localStorage.theme === "dark" ||
  (!("theme" in localStorage) &&
    window.matchMedia("(prefers-color-scheme: dark)").matches)
) {
  root.classList.add("dark");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
